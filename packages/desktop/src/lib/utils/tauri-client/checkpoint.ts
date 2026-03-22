import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type { Checkpoint, FileSnapshot, RevertResult } from "../../acp/types/index.js";
import type { FileDiffContent } from "../../services/checkpoint-types.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const checkpoint = {
	create: (
		sessionId: string,
		projectPath: string,
		modifiedFiles: string[],
		options?: {
			toolCallId?: string;
			name?: string;
			isAuto?: boolean;
			worktreePath?: string;
			agentId?: string;
		}
	): ResultAsync<Checkpoint, AppError> => {
		return invokeAsync(CMD.checkpoint.create, {
			sessionId,
			projectPath,
			worktreePath: options?.worktreePath ?? null,
			agentId: options?.agentId ?? null,
			modifiedFiles,
			toolCallId: options?.toolCallId ?? null,
			name: options?.name ?? null,
			isAuto: options?.isAuto ?? true,
		});
	},

	list: (sessionId: string): ResultAsync<Checkpoint[], AppError> => {
		return invokeAsync(CMD.checkpoint.list, { sessionId });
	},

	getFileContent: (
		sessionId: string,
		checkpointId: string,
		filePath: string
	): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.checkpoint.get_file_content, {
			sessionId,
			checkpointId,
			filePath,
		});
	},

	getFileDiffContent: (
		sessionId: string,
		checkpointId: string,
		filePath: string
	): ResultAsync<FileDiffContent, AppError> => {
		return invokeAsync<FileDiffContent>(CMD.checkpoint.get_file_diff_content, {
			sessionId,
			checkpointId,
			filePath,
		}).map((res) => ({
			oldContent: res.oldContent ?? null,
			newContent: res.newContent,
		}));
	},

	revert: (
		sessionId: string,
		checkpointId: string,
		projectPath: string,
		worktreePath?: string
	): ResultAsync<RevertResult, AppError> => {
		return invokeAsync(CMD.checkpoint.revert, {
			sessionId,
			checkpointId,
			projectPath,
			worktreePath: worktreePath ?? null,
		});
	},

	revertFile: (
		sessionId: string,
		checkpointId: string,
		filePath: string,
		projectPath: string,
		worktreePath?: string
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.checkpoint.revert_file, {
			sessionId,
			checkpointId,
			filePath,
			projectPath,
			worktreePath: worktreePath ?? null,
		});
	},

	getFileSnapshots: (
		sessionId: string,
		checkpointId: string
	): ResultAsync<FileSnapshot[], AppError> => {
		return invokeAsync(CMD.checkpoint.get_file_snapshots, { sessionId, checkpointId });
	},
};
