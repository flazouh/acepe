import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const shell = {
	openInFinder: (sessionId: string, projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.shell.open_in_finder, { sessionId, projectPath });
	},

	openStreamingLog: (sessionId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.shell.open_streaming_log, { sessionId });
	},

	getStreamingLogPath: (sessionId: string): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.shell.get_streaming_log_path, { sessionId });
	},

	getSessionFilePath: (sessionId: string, projectPath: string): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.shell.get_session_file_path, { sessionId, projectPath });
	},

	deleteSession: (sessionId: string, projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.shell.delete_session, { sessionId, projectPath });
	},

	getDefaultShell: (): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.shell.get_default_shell);
	},

	getSystemLocale: (): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.shell.get_system_locale);
	},
};
