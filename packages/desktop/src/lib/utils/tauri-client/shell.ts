import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const storageCommands = TAURI_COMMAND_CLIENT.storage;
const terminalCommands = TAURI_COMMAND_CLIENT.terminal;
const localeCommands = TAURI_COMMAND_CLIENT.locale;

export const shell = {
	openInFinder: (sessionId: string, projectPath: string): ResultAsync<void, AppError> => {
		return storageCommands.open_in_finder.invoke<void>({ sessionId, projectPath });
	},

	openStreamingLog: (sessionId: string): ResultAsync<void, AppError> => {
		return storageCommands.open_streaming_log.invoke<void>({ sessionId });
	},

	getStreamingLogPath: (sessionId: string): ResultAsync<string, AppError> => {
		return storageCommands.get_streaming_log_path.invoke<string>({ sessionId });
	},

	getSessionFilePath: (sessionId: string, projectPath: string): ResultAsync<string, AppError> => {
		return storageCommands.get_session_file_path.invoke<string>({ sessionId, projectPath });
	},

	getDefaultShell: (): ResultAsync<string, AppError> => {
		return terminalCommands.get_default_shell.invoke<string>();
	},

	getSystemLocale: (): ResultAsync<string, AppError> => {
		return localeCommands.get_system_locale.invoke<string>();
	},
};
