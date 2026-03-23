import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";

import { AgentError } from "../../acp/errors/app-error.js";

/**
 * Open a file in the system's default application.
 */
export function openFileInEditor(filePath: string): ResultAsync<void, AppError> {
	return ResultAsync.fromPromise(
		openPath(filePath),
		(error) =>
			new AgentError("open_file", error instanceof Error ? error : new Error(String(error)))
	);
}

/**
 * Reveal a file in the system's file explorer (Finder on macOS).
 */
export function revealInFinder(filePath: string): ResultAsync<void, AppError> {
	return ResultAsync.fromPromise(
		revealItemInDir(filePath),
		(error) =>
			new AgentError("reveal_in_finder", error instanceof Error ? error : new Error(String(error)))
	);
}
