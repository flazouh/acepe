import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { cursorFactFromLine, CursorJsonlLine } from "../cursor.ts"
import { makeHistoryImporter, noSessionIdFromLine } from "../importer.ts"
import { CursorHistory } from "../Services/CursorHistory.ts"

export const CursorHistoryLive = Layer.effect(
	CursorHistory,
	makeHistoryImporter({
		provider: "cursor",
		lineSchema: CursorJsonlLine,
		factFromLine: cursorFactFromLine,
		sessionIdFromLine: noSessionIdFromLine
	}).pipe(Effect.map((shape) => CursorHistory.of(shape)))
)
