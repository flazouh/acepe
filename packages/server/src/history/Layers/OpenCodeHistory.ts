import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { makeHistoryImporter, noSessionIdFromLine } from "../importer.ts"
import { opencodeFactFromLine, OpenCodeJsonlLine } from "../opencode.ts"
import { OpenCodeHistory } from "../Services/OpenCodeHistory.ts"

export const OpenCodeHistoryLive = Layer.effect(
	OpenCodeHistory,
	makeHistoryImporter({
		provider: "opencode",
		lineSchema: OpenCodeJsonlLine,
		factFromLine: opencodeFactFromLine,
		sessionIdFromLine: noSessionIdFromLine
	}).pipe(Effect.map((shape) => OpenCodeHistory.of(shape)))
)
