import * as Arr from "effect/Array"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Str from "effect/String"
import { arrayField, field, type Json, type JsonObject, jsonObjectOf, jsonText, objectField, stringField } from "./Json.ts"

// One ACP tool content block. The result text sits one level down under
// `content` for a `{ type: "content" }` block, and directly on the block for
// the flatter form some agents send for a plain tool result.
const contentBlockText = (entry: Json): Option.Option<string> => {
	const record = jsonObjectOf(entry)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const nested = objectField(record.value, "content")
	if (Option.isSome(nested)) {
		return stringField(nested.value, "text")
	}
	return stringField(record.value, "text")
}

// #273: an ACP tool_call_update reports the tool's result as content blocks
// and falls back to a free-form rawOutput. Both are read, because a settled
// call with no output reaches projection_session_activities with a status and
// no result to show — a completed read with nothing read.
//
// Shared by every ACP-speaking provider (Copilot and Cursor today) rather
// than copied into each Map.ts: the block shape belongs to the protocol, not
// to the agent behind it, so one reader is one place to correct when a
// provider turns out to send a form neither branch covers.
export const acpToolOutput = (record: JsonObject): Option.Option<string> => {
	const blocks = arrayField(record, "content")
	if (Option.isSome(blocks)) {
		const texts = Arr.filterMap(blocks.value, Filter.fromPredicateOption(contentBlockText))
		if (Arr.isReadonlyArrayNonEmpty(texts)) {
			return Option.some(Arr.join(texts, "\n"))
		}
	}
	return Option.flatMap(field(record, "rawOutput"), (value) => {
		const text = jsonText(value)
		if (text === null || Str.isNonEmpty(Str.trim(text)) === false) {
			return Option.none()
		}
		return Option.some(text)
	})
}
