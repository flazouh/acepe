import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const fsCommands = TAURI_COMMAND_CLIENT.fs;

export const fs = {
	readTextFile: (path: string, line?: number, limit?: number): ResultAsync<string, AppError> => {
		return fsCommands.read_text_file.invoke<string>({ path, line, limit });
	},

	writeTextFile: (
		path: string,
		content: string,
		sessionId: string
	): ResultAsync<void, AppError> => {
		return fsCommands.write_text_file.invoke<void>({ path, content, sessionId });
	},
};
