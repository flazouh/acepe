import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type { FileGitStatus, ProjectIndex } from "../../services/converted-session-types.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const fileIndex = {
	getProjectGitStatus: (projectPath: string): ResultAsync<FileGitStatus[], AppError> => {
		return invokeAsync(CMD.fileIndex.get_project_git_status, { projectPath });
	},

	getProjectGitStatusSummary: (projectPath: string): ResultAsync<FileGitStatus[], AppError> => {
		return invokeAsync(CMD.fileIndex.get_project_git_status_summary, { projectPath });
	},

	getProjectGitOverviewSummary: (
		projectPath: string
	): ResultAsync<{ branch: string | null; gitStatus: FileGitStatus[] }, AppError> => {
		return invokeAsync(CMD.fileIndex.get_project_git_overview_summary, { projectPath });
	},

	getProjectFiles: (projectPath: string): ResultAsync<ProjectIndex, AppError> => {
		return invokeAsync(CMD.fileIndex.get_project_files, { projectPath });
	},

	invalidateProjectFiles: (projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.fileIndex.invalidate_project_files, { projectPath });
	},

	readFileContent: (filePath: string, projectPath: string): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.fileIndex.read_file_content, { filePath, projectPath });
	},

	resolveFilePath: (filePath: string, projectPath: string): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.fileIndex.resolve_file_path, { filePath, projectPath });
	},

	getFileDiff: (
		filePath: string,
		projectPath: string
	): ResultAsync<{ oldContent: string | null; newContent: string; fileName: string }, AppError> => {
		return invokeAsync(CMD.fileIndex.get_file_diff, { filePath, projectPath });
	},

	revertFileContent: (
		filePath: string,
		projectPath: string,
		content: string
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.fileIndex.revert_file_content, {
			filePath,
			projectPath,
			content,
		});
	},

	readImageAsBase64: (filePath: string): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.fileIndex.read_image_as_base64, { filePath });
	},

	deletePath: (projectPath: string, relativePath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.fileIndex.delete_path, { projectPath, relativePath });
	},

	renamePath: (
		projectPath: string,
		fromRelative: string,
		toRelative: string
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.fileIndex.rename_path, {
			projectPath,
			fromRelative,
			toRelative,
		});
	},

	copyFile: (projectPath: string, relativePath: string): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.fileIndex.copy_file, { projectPath, relativePath });
	},

	createFile: (projectPath: string, relativePath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.fileIndex.create_file, { projectPath, relativePath });
	},

	createDirectory: (projectPath: string, relativePath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.fileIndex.create_directory, {
			projectPath,
			relativePath,
		});
	},
};
