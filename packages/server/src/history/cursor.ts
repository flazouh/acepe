import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { asNonEmptyText, JsonTextContent } from "./text.ts"
import type { HistoryTextFact } from "./text.ts"

export const CursorMessage = Schema.Struct({
	content: Schema.optionalKey(JsonTextContent)
})
export type CursorMessage = typeof CursorMessage.Type

export const CursorJsonlLine = Schema.Struct({
	role: Schema.String,
	message: Schema.optionalKey(CursorMessage),
	content: Schema.optionalKey(JsonTextContent)
})
export type CursorJsonlLine = typeof CursorJsonlLine.Type

const cursorContent = (line: CursorJsonlLine): Option.Option<JsonTextContent> => {
	if (line.message !== undefined && line.message.content !== undefined) {
		return Option.some(line.message.content)
	}
	if (line.content !== undefined) {
		return Option.some(line.content)
	}
	return Option.none()
}

export const cursorFactFromLine = (line: CursorJsonlLine): Option.Option<HistoryTextFact> => {
	if (line.role !== "user" && line.role !== "assistant") {
		return Option.none()
	}
	const content = cursorContent(line)
	if (Option.isNone(content)) {
		return Option.none()
	}
	const text = asNonEmptyText(content.value)
	if (Option.isNone(text)) {
		return Option.none()
	}
	return Option.some({
		role: line.role,
		text: text.value
	})
}
