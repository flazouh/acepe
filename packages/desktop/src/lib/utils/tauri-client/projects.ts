import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { CMD } from "./commands.js";

import { invokeAsync } from "./invoke.js";
import type { ProjectData } from "./types.js";

export const projects = {
	getProjects: (): ResultAsync<ProjectData[], AppError> => {
		return invokeAsync(CMD.projects.get_projects);
	},

	getRecentProjects: (limit = 100): ResultAsync<ProjectData[], AppError> => {
		return invokeAsync(CMD.projects.get_recent_projects, { limit });
	},

	getProjectCount: (): ResultAsync<number, AppError> => {
		return invokeAsync(CMD.projects.get_project_count);
	},

	importProject: (path: string, name: string): ResultAsync<ProjectData, AppError> => {
		return invokeAsync(CMD.projects.import_project, { path, name });
	},

	updateProjectColor: (path: string, color: string): ResultAsync<ProjectData, AppError> => {
		return invokeAsync(CMD.projects.update_project_color, { path, color });
	},

	addProject: (path: string, name: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.projects.add_project, { path, name });
	},

	removeProject: (path: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.projects.remove_project, { path });
	},

	browseProject: (): ResultAsync<ProjectData | null, AppError> => {
		return invokeAsync(CMD.projects.browse_project);
	},
};
