import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import type { Checkpoint, FileSnapshot, RevertResult } from "../../acp/types/index.js";
import type { FileDiffContent } from "../../services/checkpoint-types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const checkpointCommands = TAURI_COMMAND_CLIENT.checkpoint;

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
		return checkpointCommands.create.invoke<Checkpoint>({
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
		return checkpointCommands.list.invoke<Checkpoint[]>({ sessionId });
	},

	getFileContent: (
		sessionId: string,
		checkpointId: string,
		filePath: string
	): ResultAsync<string, AppError> => {
		return checkpointCommands.get_file_content.invoke<string>({
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
		return checkpointCommands.get_file_diff_content.invoke<FileDiffContent>({
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
		return checkpointCommands.revert.invoke<RevertResult>({
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
		return checkpointCommands.revert_file.invoke<void>({
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
		return checkpointCommands.get_file_snapshots.invoke<FileSnapshot[]>({
			sessionId,
			checkpointId,
		});
	},
};
