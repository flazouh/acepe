import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const fsCommands = TAURI_COMMAND_CLIENT.fs;

export const fs = {
	readTextFile: (path: string, line?: number, limit?: number): Effect.Effect<string, AppError> => {
		return fsCommands.read_text_file.invoke<string>({ path, line, limit });
	},

	writeTextFile: (
		path: string,
		content: string,
		sessionId: string
	): Effect.Effect<void, AppError> => {
		return fsCommands.write_text_file.invoke<void>({ path, content, sessionId });
	},
};
