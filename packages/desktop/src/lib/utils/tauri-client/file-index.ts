import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import type {
	FileExplorerPreviewResponse,
	FileExplorerSearchResponse,
	FileGitStatus,
	ProjectIndex,
} from "../../services/converted-session-types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const fileIndexCommands = TAURI_COMMAND_CLIENT.file_index;

export const fileIndex = {
	getProjectGitStatus: (projectPath: string): ResultAsync<FileGitStatus[], AppError> => {
		return fileIndexCommands.get_project_git_status.invoke<FileGitStatus[]>({ projectPath });
	},

	getProjectGitStatusSummary: (projectPath: string): ResultAsync<FileGitStatus[], AppError> => {
		return fileIndexCommands.get_project_git_status_summary.invoke<FileGitStatus[]>({
			projectPath,
		});
	},

	getProjectGitOverviewSummary: (
		projectPath: string
	): ResultAsync<{ branch: string | null; gitStatus: FileGitStatus[] }, AppError> => {
		return fileIndexCommands.get_project_git_overview_summary.invoke<{
			branch: string | null;
			gitStatus: FileGitStatus[];
		}>({ projectPath });
	},

	getProjectFiles: (projectPath: string): ResultAsync<ProjectIndex, AppError> => {
		return fileIndexCommands.get_project_files.invoke<ProjectIndex>({ projectPath });
	},

	invalidateProjectFiles: (projectPath: string): ResultAsync<void, AppError> => {
		return fileIndexCommands.invalidate_project_files.invoke<void>({ projectPath });
	},

	readFileContent: (filePath: string, projectPath: string): ResultAsync<string, AppError> => {
		return fileIndexCommands.read_file_content.invoke<string>({ filePath, projectPath });
	},

	resolveFilePath: (filePath: string, projectPath: string): ResultAsync<string, AppError> => {
		return fileIndexCommands.resolve_file_path.invoke<string>({ filePath, projectPath });
	},

	getFileDiff: (
		filePath: string,
		projectPath: string
	): ResultAsync<{ oldContent: string | null; newContent: string; fileName: string }, AppError> => {
		return fileIndexCommands.get_file_diff.invoke<{
			oldContent: string | null;
			newContent: string;
			fileName: string;
		}>({ filePath, projectPath });
	},

	revertFileContent: (
		filePath: string,
		projectPath: string,
		content: string
	): ResultAsync<void, AppError> => {
		return fileIndexCommands.revert_file_content.invoke<void>({
			filePath,
			projectPath,
			content,
		});
	},

	readImageAsBase64: (filePath: string): ResultAsync<string, AppError> => {
		return fileIndexCommands.read_image_as_base64.invoke<string>({ filePath });
	},

	deletePath: (projectPath: string, relativePath: string): ResultAsync<void, AppError> => {
		return fileIndexCommands.delete_path.invoke<void>({ projectPath, relativePath });
	},

	renamePath: (
		projectPath: string,
		fromRelative: string,
		toRelative: string
	): ResultAsync<void, AppError> => {
		return fileIndexCommands.rename_path.invoke<void>({
			projectPath,
			fromRelative,
			toRelative,
		});
	},

	copyFile: (projectPath: string, relativePath: string): ResultAsync<string, AppError> => {
		return fileIndexCommands.copy_file.invoke<string>({ projectPath, relativePath });
	},

	createFile: (projectPath: string, relativePath: string): ResultAsync<void, AppError> => {
		return fileIndexCommands.create_file.invoke<void>({ projectPath, relativePath });
	},

	createDirectory: (projectPath: string, relativePath: string): ResultAsync<void, AppError> => {
		return fileIndexCommands.create_directory.invoke<void>({
			projectPath,
			relativePath,
		});
	},

	searchProjectFilesForExplorer: (
		projectPath: string,
		query: string,
		limit: number,
		offset: number
	): ResultAsync<FileExplorerSearchResponse, AppError> => {
		return fileIndexCommands.search_project_files_for_explorer.invoke<FileExplorerSearchResponse>({
			projectPath,
			query,
			limit,
			offset,
		});
	},

	getFileExplorerPreview: (
		projectPath: string,
		filePath: string
	): ResultAsync<FileExplorerPreviewResponse, AppError> => {
		return fileIndexCommands.get_file_explorer_preview.invoke<FileExplorerPreviewResponse>({
			projectPath,
			filePath,
		});
	},
};
