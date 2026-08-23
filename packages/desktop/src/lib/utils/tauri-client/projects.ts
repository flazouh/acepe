import {
	decodeProjectId,
	librarySnapshotRequest,
	type RpcProjectedProject,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";

import { AgentError, type AppError } from "../../acp/errors/app-error.js";
import { UI } from "../../acp/constants/ui.js";
import {
	decodeEffect,
	decodeTrimmed,
	nextCommandId,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";
import type { ProjectAcepeConfig, ProjectData } from "./types.js";

const mapProject = (row: RpcProjectedProject): ProjectData => ({
	path: row.workspaceRoot,
	name: row.title,
	last_opened: row.updatedAt,
	created_at: row.createdAt,
	color: UI.DEFAULT_PROJECT_COLOR,
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

const dispatchProjectCreate = Effect.fn("dispatchProjectCreate")(function* (
	path: string,
	name: string
) {
	const workspaceRoot = yield* decodeTrimmed("project.create", path);
	const title = yield* decodeTrimmed("project.create", name);
	const commandId = yield* nextCommandId("project-create");
	const projectId = yield* decodeEffect("project.create", decodeProjectId)(
		`project-${String(commandId)}`
	);
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
		const snapshot = yield* withRpcClient("projects.snapshot", (client) =>
			client.snapshot(librarySnapshotRequest())
		);
		const created = findProjectedByPath(snapshot.projects, workspaceRoot);
		if (created === null) {
			return yield* Effect.fail(
				new AgentError("project.create", new Error("created project missing from snapshot"))
			);
		}
		return mapProject(created);
	}),

	updateProjectColor: (
		_path: string,
		_color: string
	): Effect.Effect<ProjectData, AppError> => unsupportedOnContract("projects.updateProjectColor"),

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
		const loaded = yield* loadVisibleProjects();
		const existing = findProjectedByPath(loaded.snapshot.projects, path);
		if (existing === null) {
			return yield* Effect.fail(
				new AgentError("project.delete", new Error("project not found"))
			);
		}
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
