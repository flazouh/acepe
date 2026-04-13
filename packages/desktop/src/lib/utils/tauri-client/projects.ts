import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type { ProjectData } from "./types.js";

const storageCommands = TAURI_COMMAND_CLIENT.storage;

export const projects = {
	getProjects: (): ResultAsync<ProjectData[], AppError> => {
		return storageCommands.get_projects.invoke<ProjectData[]>();
	},

	getRecentProjects: (limit = 100): ResultAsync<ProjectData[], AppError> => {
		return storageCommands.get_recent_projects.invoke<ProjectData[]>({ limit });
	},

	getProjectCount: (): ResultAsync<number, AppError> => {
		return storageCommands.get_project_count.invoke<number>();
	},

	getMissingProjectPaths: (paths: string[]): ResultAsync<string[], AppError> => {
		return storageCommands.get_missing_project_paths.invoke<string[]>({ paths });
	},

	importProject: (path: string, name: string): ResultAsync<ProjectData, AppError> => {
		return storageCommands.import_project.invoke<ProjectData>({ path, name });
	},

	updateProjectColor: (path: string, color: string): ResultAsync<ProjectData, AppError> => {
		return storageCommands.update_project_color.invoke<ProjectData>({ path, color });
	},

	updateProjectIcon: (
		path: string,
		iconPath: string | null
	): ResultAsync<ProjectData, AppError> => {
		return storageCommands.update_project_icon.invoke<ProjectData>({ path, iconPath });
	},

	updateProjectOrder: (orderedPaths: string[]): ResultAsync<ProjectData[], AppError> => {
		return storageCommands.update_project_order.invoke<ProjectData[]>({ orderedPaths });
	},

	addProject: (path: string, name: string): ResultAsync<void, AppError> => {
		return storageCommands.add_project.invoke<void>({ path, name });
	},

	removeProject: (path: string): ResultAsync<void, AppError> => {
		return storageCommands.remove_project.invoke<void>({ path });
	},

	browseProject: (): ResultAsync<ProjectData | null, AppError> => {
		return storageCommands.browse_project.invoke<ProjectData | null>();
	},
};
