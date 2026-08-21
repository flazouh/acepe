import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type { ProjectAcepeConfig, ProjectData } from "./types.js";

const storageCommands = TAURI_COMMAND_CLIENT.storage;

export const projects = {
	getProjects: (): Effect.Effect<ProjectData[], AppError> => {
		return storageCommands.get_projects.invoke<ProjectData[]>();
	},

	getRecentProjects: (
		limit = 50,
		preferredPaths: string[] = [],
		offset = 0
	): Effect.Effect<ProjectData[], AppError> => {
		return storageCommands.get_recent_projects.invoke<ProjectData[]>({
			limit,
			preferredPaths,
			offset,
		});
	},

	getProjectCount: (): Effect.Effect<number, AppError> => {
		return storageCommands.get_project_count.invoke<number>();
	},

	getMissingProjectPaths: (paths: string[]): Effect.Effect<string[], AppError> => {
		return storageCommands.get_missing_project_paths.invoke<string[]>({ paths });
	},

	importProject: (path: string, name: string): Effect.Effect<ProjectData, AppError> => {
		return storageCommands.import_project.invoke<ProjectData>({ path, name });
	},

	updateProjectColor: (path: string, color: string): Effect.Effect<ProjectData, AppError> => {
		return storageCommands.update_project_color.invoke<ProjectData>({ path, color });
	},

	updateProjectIcon: (
		path: string,
		iconPath: string | null
	): Effect.Effect<ProjectData, AppError> => {
		return storageCommands.update_project_icon.invoke<ProjectData>({ path, iconPath });
	},

	getProjectAcepeConfig: (path: string): Effect.Effect<ProjectAcepeConfig, AppError> => {
		return storageCommands.get_project_acepe_config.invoke<ProjectAcepeConfig>({ path });
	},

	saveProjectAcepeConfig: (
		path: string,
		config: ProjectAcepeConfig
	): Effect.Effect<ProjectAcepeConfig, AppError> => {
		return storageCommands.save_project_acepe_config.invoke<ProjectAcepeConfig>({ path, config });
	},

	updateProjectOrder: (orderedPaths: string[]): Effect.Effect<ProjectData[], AppError> => {
		return storageCommands.update_project_order.invoke<ProjectData[]>({ orderedPaths });
	},

	addProject: (path: string, name: string): Effect.Effect<void, AppError> => {
		return storageCommands.add_project.invoke<void>({ path, name });
	},

	backfillProjectIcons: (): Effect.Effect<number, AppError> => {
		return storageCommands.backfill_project_icons.invoke<number>();
	},

	removeProject: (path: string): Effect.Effect<void, AppError> => {
		return storageCommands.remove_project.invoke<void>({ path });
	},

	browseProject: (): Effect.Effect<ProjectData | null, AppError> => {
		return storageCommands.browse_project.invoke<ProjectData | null>();
	},

	browseProjectIcon: (): Effect.Effect<string | null, AppError> => {
		return storageCommands.browse_project_icon.invoke<string | null>();
	},

	listProjectImages: (projectPath: string): Effect.Effect<string[], AppError> => {
		return storageCommands.list_project_images.invoke<string[]>({ projectPath });
	},
};
