import { fromPromise } from "@acepe/effect-result/fromPromise";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";

import { AgentError } from "../../acp/errors/app-error.js";

/**
 * Open a file in the system's default application.
 */
export function openFileInEditor(filePath: string): Effect.Effect<void, AppError> {
	return fromPromise(
		() => openPath(filePath),
		(error) =>
			new AgentError("open_file", error instanceof Error ? error : new Error(String(error)))
	);
}

/**
 * Reveal a file in the system's file explorer (Finder on macOS).
 */
export function revealInFinder(filePath: string): Effect.Effect<void, AppError> {
	return fromPromise(
		() => revealItemInDir(filePath),
		(error) =>
			new AgentError("reveal_in_finder", error instanceof Error ? error : new Error(String(error)))
	);
}
