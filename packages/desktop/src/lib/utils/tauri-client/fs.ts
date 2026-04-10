import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const fs = {
	readTextFile: (path: string, line?: number, limit?: number): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.fs.read_text_file, { path, line, limit });
	},

	writeTextFile: (
		path: string,
		content: string,
		sessionId: string
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.fs.write_text_file, { path, content, sessionId });
	},
};
