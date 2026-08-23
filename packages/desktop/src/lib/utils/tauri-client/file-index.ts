import type {
	FileGitStatus as ContractFileGitStatus,
	ProjectIndex as ContractProjectIndex,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import type {
	FileExplorerPreviewResponse,
	FileGitStatus,
	ProjectIndex,
} from "../../services/converted-session-types.js";
import {
	decodeTrimmed,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";

const mapGitStatus = (row: ContractFileGitStatus): FileGitStatus => ({
	path: row.path,
	status: row.status,
	insertions: row.insertions,
	deletions: row.deletions,
});

const mapProjectIndex = (index: ContractProjectIndex): ProjectIndex => {
	const files: ProjectIndex["files"] = [];
	for (const file of index.files) {
		files.push({
			path: file.path,
			extension: file.extension,
			lineCount: file.lineCount,
			gitStatus: file.gitStatus === null ? null : mapGitStatus(file.gitStatus),
		});
	}
	const gitStatus: FileGitStatus[] = [];
	for (const row of index.gitStatus) {
		gitStatus.push(mapGitStatus(row));
	}
	return {
		projectPath: index.projectPath,
		files,
		gitStatus,
		totalFiles: index.totalFiles,
		totalLines: index.totalLines,
	};
};

const loadProjectIndex = Effect.fn("loadProjectIndex")(function* (projectPath: string) {
	const decodedPath = yield* decodeTrimmed("fileIndex.getProjectIndex", projectPath);
	const index = yield* withRpcClient("fileIndex.getProjectIndex", (client) =>
		client.getProjectIndex(decodedPath)
	);
	return mapProjectIndex(index);
});

export const fileIndex = {
	getProjectGitStatus: (projectPath: string): Effect.Effect<FileGitStatus[], AppError> =>
		loadProjectIndex(projectPath).pipe(Effect.map((index) => index.gitStatus)),

	getProjectGitStatusSummary: (
		projectPath: string
	): Effect.Effect<FileGitStatus[], AppError> =>
		loadProjectIndex(projectPath).pipe(Effect.map((index) => index.gitStatus)),

	getFileGitStatusSummary: (
		projectPath: string,
		filePath: string
	): Effect.Effect<FileGitStatus | null, AppError> =>
		loadProjectIndex(projectPath).pipe(
			Effect.map((index) => {
				for (const row of index.gitStatus) {
					if (row.path === filePath) {
						return row;
					}
				}
				return null;
			})
		),

	getProjectGitOverviewSummary: (
		projectPath: string
	): Effect.Effect<{ branch: string | null; gitStatus: FileGitStatus[] }, AppError> =>
		loadProjectIndex(projectPath).pipe(
			Effect.map((index) => ({
				branch: null,
				gitStatus: index.gitStatus,
			}))
		),

	getProjectFiles: (projectPath: string): Effect.Effect<ProjectIndex, AppError> =>
		loadProjectIndex(projectPath),

	invalidateProjectFiles: (projectPath: string): Effect.Effect<void, AppError> =>
		decodeTrimmed("fileIndex.invalidateProjectIndex", projectPath).pipe(
			Effect.flatMap((decodedPath) =>
				withRpcClient("fileIndex.invalidateProjectIndex", (client) =>
					client.invalidateProjectIndex(decodedPath)
				)
			)
		),

	readFileContent: (
		_filePath: string,
		_projectPath: string
	): Effect.Effect<string, AppError> => unsupportedOnContract("fileIndex.readFileContent"),

	resolveFilePath: (
		_filePath: string,
		_projectPath: string
	): Effect.Effect<string, AppError> => unsupportedOnContract("fileIndex.resolveFilePath"),

	getFileDiff: (
		_filePath: string,
		_projectPath: string
	): Effect.Effect<
		{ oldContent: string | null; newContent: string; fileName: string },
		AppError
	> => unsupportedOnContract("fileIndex.getFileDiff"),

	revertFileContent: (
		_filePath: string,
		_projectPath: string,
		_content: string
	): Effect.Effect<void, AppError> => unsupportedOnContract("fileIndex.revertFileContent"),

	readImageAsBase64: (_filePath: string): Effect.Effect<string, AppError> =>
		unsupportedOnContract("fileIndex.readImageAsBase64"),

	deletePath: (
		_projectPath: string,
		_relativePath: string
	): Effect.Effect<void, AppError> => unsupportedOnContract("fileIndex.deletePath"),

	renamePath: (
		_projectPath: string,
		_fromRelative: string,
		_toRelative: string
	): Effect.Effect<void, AppError> => unsupportedOnContract("fileIndex.renamePath"),

	copyFile: (
		_projectPath: string,
		_relativePath: string
	): Effect.Effect<string, AppError> => unsupportedOnContract("fileIndex.copyFile"),

	createFile: (
		_projectPath: string,
		_relativePath: string
	): Effect.Effect<void, AppError> => unsupportedOnContract("fileIndex.createFile"),

	createDirectory: (
		_projectPath: string,
		_relativePath: string
	): Effect.Effect<void, AppError> => unsupportedOnContract("fileIndex.createDirectory"),

	getFileExplorerPreview: (
		_projectPath: string,
		_filePath: string
	): Effect.Effect<FileExplorerPreviewResponse, AppError> =>
		unsupportedOnContract("fileIndex.getFileExplorerPreview"),
};
