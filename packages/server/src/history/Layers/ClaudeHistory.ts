import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { claudeFactFromLine, ClaudeJsonlLine, claudeSessionIdFromLine } from "../claude.ts"
import { makeHistoryImporter } from "../importer.ts"
import { ClaudeHistory } from "../Services/ClaudeHistory.ts"

export const ClaudeHistoryLive = Layer.effect(
	ClaudeHistory,
	makeHistoryImporter({
		provider: "claude",
		lineSchema: ClaudeJsonlLine,
		factFromLine: claudeFactFromLine,
		sessionIdFromLine: claudeSessionIdFromLine
	}).pipe(Effect.map((shape) => ClaudeHistory.of(shape)))
)
