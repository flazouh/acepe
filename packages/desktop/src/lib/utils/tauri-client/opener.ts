import { fromPromise } from "@acepe/effect-result/fromPromise";
import type * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { AgentError } from "../../acp/errors/app-error.js";
import { convertFileSrc } from "../file-src.js";
import { openUrl } from "../open-url.js";

export function openFileInEditor(filePath: string): Effect.Effect<void, AppError> {
	return fromPromise(
		() => openUrl(convertFileSrc(filePath)),
		(error) =>
			new AgentError("open_file", error instanceof Error ? error : new Error(String(error)))
	);
}

export function revealInFinder(filePath: string): Effect.Effect<void, AppError> {
	return fromPromise(
		() => openUrl(convertFileSrc(filePath)),
		(error) =>
			new AgentError("reveal_in_finder", error instanceof Error ? error : new Error(String(error)))
	);
}
