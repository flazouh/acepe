import {
	decodeProjectId,
	librarySnapshotRequest,
	ProjectColor,
	ProjectMetaUpdateCommand,
	type RpcProjectedProject,
} from "@acepe/contracts";
import { normalizeColorName } from "@acepe/ui/colors";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AgentError, type AppError } from "../../acp/errors/app-error.js";
import {
	decodeEffect,
	decodeTrimmed,
	nextCommandId,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";
import type { ProjectAcepeConfig, ProjectData } from "./types.js";

const decodeProjectColor = Schema.decodeUnknownEffect(ProjectColor);

// color is a canonical color name owned by the projection, never a local guess.
const mapProject = (row: RpcProjectedProject): ProjectData => ({
	path: row.workspaceRoot,
	name: row.title,
	last_opened: row.updatedAt,
	created_at: row.createdAt,
	color: row.color,
	sort_order: 0,
	icon_path: null,
});

const loadVisibleProjects = Effect.fn("loadVisibleProjects")(function* () {
	const snapshot = yield* withRpcClient("projects.snapshot", (client) =>
		client.snapshot(librarySnapshotRequest())
	);
	const visible: ProjectData[] = [];
	for (const row of snapshot.projects) {
		if (row.deletedAt === null) {
			visible.push(mapProject(row));
		}
	}
	return { snapshot, visible };
});

const findProjectedByPath = (
	rows: readonly RpcProjectedProject[],
	workspaceRoot: string
): RpcProjectedProject | null => {
	for (const row of rows) {
		if (row.deletedAt === null && row.workspaceRoot === workspaceRoot) {
			return row;
		}
	}
	return null;
};

const requireProjectedByPath = Effect.fn("requireProjectedByPath")(function* (
	operation: string,
	workspaceRoot: string
) {
	const snapshot = yield* withRpcClient("projects.snapshot", (client) =>
		client.snapshot(librarySnapshotRequest())
	);
	const row = findProjectedByPath(snapshot.projects, workspaceRoot);
	if (row === null) {
		return yield* Effect.fail(new AgentError(operation, new Error("project not found")));
	}
	return row;
});

const dispatchProjectCreate = Effect.fn("dispatchProjectCreate")(function* (
	path: string,
	name: string
) {
	const workspaceRoot = yield* decodeTrimmed("project.create", path);
	const title = yield* decodeTrimmed("project.create", name);
	const commandId = yield* nextCommandId("project-create");
	const projectId = yield* decodeEffect(
		"project.create",
		decodeProjectId
	)(`project-${String(commandId)}`);
	yield* withRpcClient("project.create", (client) =>
		client.dispatch({
			type: "project.create",
			commandId,
			projectId,
			title,
			workspaceRoot,
		})
	);
	return workspaceRoot;
});

export const projects = {
	getProjects: (): Effect.Effect<ProjectData[], AppError> =>
		loadVisibleProjects().pipe(Effect.map((loaded) => loaded.visible)),

	getRecentProjects: (
		limit = 50,
		preferredPaths: string[] = [],
		offset = 0
	): Effect.Effect<ProjectData[], AppError> =>
		loadVisibleProjects().pipe(
			Effect.map((loaded) => {
				const preferred: ProjectData[] = [];
				const rest: ProjectData[] = [];
				for (const project of loaded.visible) {
					let isPreferred = false;
					for (const preferredPath of preferredPaths) {
						if (preferredPath === project.path) {
							isPreferred = true;
						}
					}
					if (isPreferred) {
						preferred.push(project);
					} else {
						rest.push(project);
					}
				}
				const ordered: ProjectData[] = [];
				for (const project of preferred) {
					ordered.push(project);
				}
				for (const project of rest) {
					ordered.push(project);
				}
				return ordered.slice(offset, offset + limit);
			})
		),

	getProjectCount: (): Effect.Effect<number, AppError> =>
		loadVisibleProjects().pipe(Effect.map((loaded) => loaded.visible.length)),

	getMissingProjectPaths: (_paths: string[]): Effect.Effect<string[], AppError> =>
		Effect.succeed([]),

	importProject: Effect.fn("projects.importProject")(function* (path: string, name: string) {
		const workspaceRoot = yield* dispatchProjectCreate(path, name);
		const created = yield* requireProjectedByPath("project.create", workspaceRoot);
		return mapProject(created);
	}),

	// Returns the picked color rather than re-reading the snapshot: dispatch
	// commits the event, but the SQL projection catches up on its own fiber, so
	// an immediate read can still answer with the old color and revert the pick.
	// The authoritative row arrives with the ProjectMetaUpdated refresh.
	updateProjectColor: Effect.fn("projects.updateProjectColor")(function* (
		path: string,
		color: string
	) {
		const decodedColor = yield* decodeEffect(
			"projects.updateProjectColor",
			decodeProjectColor
		)(normalizeColorName(color));
		const existing = yield* requireProjectedByPath("project.meta.update", path);
		const commandId = yield* nextCommandId("project-meta-update-color");
		yield* withRpcClient("project.meta.update", (client) =>
			client.dispatch(
				ProjectMetaUpdateCommand.make({
					type: "project.meta.update",
					commandId,
					projectId: existing.projectId,
					color: decodedColor,
				})
			)
		);
		return {
			path: existing.workspaceRoot,
			name: existing.title,
			last_opened: existing.updatedAt,
			created_at: existing.createdAt,
			color: decodedColor,
			sort_order: 0,
			icon_path: null,
		};
	}),

	updateProjectIcon: (
		_path: string,
		_iconPath: string | null
	): Effect.Effect<ProjectData, AppError> => unsupportedOnContract("projects.updateProjectIcon"),

	getProjectAcepeConfig: (_path: string): Effect.Effect<ProjectAcepeConfig, AppError> =>
		unsupportedOnContract("projects.getProjectAcepeConfig"),

	saveProjectAcepeConfig: (
		_path: string,
		_config: ProjectAcepeConfig
	): Effect.Effect<ProjectAcepeConfig, AppError> =>
		unsupportedOnContract("projects.saveProjectAcepeConfig"),

	updateProjectOrder: (_orderedPaths: string[]): Effect.Effect<ProjectData[], AppError> =>
		unsupportedOnContract("projects.updateProjectOrder"),

	addProject: Effect.fn("projects.addProject")(function* (path: string, name: string) {
		yield* dispatchProjectCreate(path, name);
	}),

	backfillProjectIcons: (): Effect.Effect<number, AppError> => Effect.succeed(0),

	removeProject: Effect.fn("projects.removeProject")(function* (path: string) {
		const existing = yield* requireProjectedByPath("project.delete", path);
		const commandId = yield* nextCommandId("project-delete");
		yield* withRpcClient("project.delete", (client) =>
			client.dispatch({
				type: "project.delete",
				commandId,
				projectId: existing.projectId,
			})
		);
	}),

	browseProject: (): Effect.Effect<ProjectData | null, AppError> => Effect.succeed(null),

	browseProjectIcon: (): Effect.Effect<string | null, AppError> => Effect.succeed(null),

	listProjectImages: (_projectPath: string): Effect.Effect<string[], AppError> =>
		Effect.succeed([]),
};
