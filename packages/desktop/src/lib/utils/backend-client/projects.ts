import {
	decodeProjectId,
	librarySnapshotRequest,
	ProjectColor,
	type ProjectIcon,
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

// color, sort_order and the icon are canonical values owned by the
// projection, never a local guess. iconPath in particular is the server's
// resolution of the choice against the filesystem, so nothing here re-derives
// it from icon.
const mapProject = (row: RpcProjectedProject): ProjectData => ({
	path: row.workspaceRoot,
	name: row.title,
	last_opened: row.updatedAt,
	created_at: row.createdAt,
	color: row.color,
	sort_order: row.sortOrder,
	show_external_cli_sessions: row.showExternalCliSessions,
	icon: row.icon,
	icon_path: row.iconPath,
});

export interface RankedProject {
	readonly row: RpcProjectedProject;
	readonly sortOrder: number;
}

/**
 * Turns a requested order into dense ranks 0..n-1.
 *
 * Paths the snapshot does not know are skipped, and projects the caller did not
 * mention keep their relative order at the end of the list. Two projects can
 * share a workspace root, so a path matches the first unranked row that carries
 * it and the other one lands in the tail.
 */
export const rankProjectsForOrder = (
	rows: readonly RpcProjectedProject[],
	orderedPaths: readonly string[]
): RankedProject[] => {
	const ranked: RankedProject[] = [];
	const taken = new Set<RpcProjectedProject>();
	for (const path of orderedPaths) {
		for (const row of rows) {
			if (row.workspaceRoot === path && !taken.has(row)) {
				taken.add(row);
				ranked.push({ row, sortOrder: ranked.length });
				break;
			}
		}
	}
	for (const row of rows) {
		if (!taken.has(row)) {
			ranked.push({ row, sortOrder: ranked.length });
		}
	}
	return ranked;
};

const loadVisibleProjects = Effect.fn("loadVisibleProjects")(function* () {
	const snapshot = yield* withRpcClient("projects.snapshot", (client) =>
		client.snapshot(librarySnapshotRequest())
	);
	const rows: RpcProjectedProject[] = [];
	const visible: ProjectData[] = [];
	for (const row of snapshot.projects) {
		if (row.deletedAt === null) {
			rows.push(row);
			visible.push(mapProject(row));
		}
	}
	return { snapshot, rows, visible };
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
			sort_order: existing.sortOrder,
			show_external_cli_sessions: existing.showExternalCliSessions,
		};
	}),

	updateProjectShowExternalCliSessions: Effect.fn("projects.updateProjectShowExternalCliSessions")(
		function* (path: string, show: boolean) {
			const existing = yield* requireProjectedByPath("project.meta.update", path);
			const commandId = yield* nextCommandId("project-meta-update-external-sessions");
			yield* withRpcClient("project.meta.update", (client) =>
				client.dispatch(
					ProjectMetaUpdateCommand.make({
						type: "project.meta.update",
						commandId,
						projectId: existing.projectId,
						showExternalCliSessions: show,
					})
				)
			);
		}
	),

	/**
	 * Set which icon a project shows.
	 *
	 * Only the choice travels. The picture it resolves to comes back on the
	 * next snapshot, because the server is the one that pairs the choice with
	 * what is on disk.
	 */
	updateProjectIcon: Effect.fn("projects.updateProjectIcon")(function* (
		path: string,
		icon: ProjectIcon
	) {
		const existing = yield* requireProjectedByPath("project.meta.update", path);
		const commandId = yield* nextCommandId("project-meta-update-icon");
		yield* withRpcClient("project.meta.update", (client) =>
			client.dispatch(
				ProjectMetaUpdateCommand.make({
					type: "project.meta.update",
					commandId,
					projectId: existing.projectId,
					icon,
				})
			)
		);
		return {
			path: existing.workspaceRoot,
			name: existing.title,
			last_opened: existing.updatedAt,
			created_at: existing.createdAt,
			color: existing.color,
			sort_order: existing.sortOrder,
			show_external_cli_sessions: existing.showExternalCliSessions,
			icon,
			// Absent rather than guessed: only the server knows whether this
			// choice resolves to a file that is actually there. Callers must
			// keep the iconPath they already had until the refresh lands.
			icon_path: undefined,
		};
	}),

	getProjectAcepeConfig: (_path: string): Effect.Effect<ProjectAcepeConfig, AppError> =>
		unsupportedOnContract("projects.getProjectAcepeConfig"),

	saveProjectAcepeConfig: (
		_path: string,
		_config: ProjectAcepeConfig
	): Effect.Effect<ProjectAcepeConfig, AppError> =>
		unsupportedOnContract("projects.saveProjectAcepeConfig"),

	// Dispatches the canonical rank for every project the move actually moved,
	// then answers with the list it just wrote. Reading the snapshot back here
	// would answer with the old ranks: dispatch commits the event, but the SQL
	// projection catches up on its own fiber. The authoritative rows arrive with
	// the ProjectMetaUpdated refresh.
	updateProjectOrder: Effect.fn("projects.updateProjectOrder")(function* (orderedPaths: string[]) {
		const loaded = yield* loadVisibleProjects();
		const ranked = rankProjectsForOrder(loaded.rows, orderedPaths);
		for (const entry of ranked) {
			if (entry.row.sortOrder === entry.sortOrder) {
				continue;
			}
			const commandId = yield* nextCommandId("project-meta-update-sort-order");
			yield* withRpcClient("project.meta.update", (client) =>
				client.dispatch(
					ProjectMetaUpdateCommand.make({
						type: "project.meta.update",
						commandId,
						projectId: entry.row.projectId,
						sortOrder: entry.sortOrder,
					})
				)
			);
		}
		return ranked.map((entry) => ({ ...mapProject(entry.row), sort_order: entry.sortOrder }));
	}),

	addProject: Effect.fn("projects.addProject")(function* (path: string, name: string) {
		yield* dispatchProjectCreate(path, name);
	}),

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
};
