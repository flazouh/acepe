import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { asNonEmptyText, type HistoryTextFact, JsonTextContent } from "./text.ts"

export const SKIPPED_CLAUDE_TYPES = [
	"file-history-snapshot",
	"queue-operation",
	"summary",
	"progress",
	"system"
] as const

export const ClaudeMessage = Schema.Struct({
	role: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(JsonTextContent)
})
export type ClaudeMessage = typeof ClaudeMessage.Type

export const ClaudeJsonlLine = Schema.Struct({
	type: Schema.String,
	uuid: Schema.optionalKey(Schema.String),
	sessionId: Schema.optionalKey(Schema.String),
	timestamp: Schema.optionalKey(Schema.String),
	isMeta: Schema.optionalKey(Schema.Boolean),
	isSidechain: Schema.optionalKey(Schema.Boolean),
	message: Schema.optionalKey(ClaudeMessage)
})
export type ClaudeJsonlLine = typeof ClaudeJsonlLine.Type

const isSkippedType = (type: string): boolean =>
	SKIPPED_CLAUDE_TYPES.find((skipped) => skipped === type) !== undefined

export const claudeFactFromLine = (line: ClaudeJsonlLine): Option.Option<HistoryTextFact> => {
	if (isSkippedType(line.type)) {
		return Option.none()
	}
	if (line.isMeta === true || line.isSidechain === true) {
		return Option.none()
	}
	if (line.type !== "user" && line.type !== "assistant") {
		return Option.none()
	}
	if (line.message === undefined || line.message.content === undefined) {
		return Option.none()
	}
	const text = asNonEmptyText(line.message.content)
	if (Option.isNone(text)) {
		return Option.none()
	}
	return Option.some({
		role: line.type,
		text: text.value
	})
}

export const claudeSessionIdFromLine = (line: ClaudeJsonlLine): Option.Option<string> => {
	if (line.sessionId === undefined) {
		return Option.none()
	}
	const trimmed = line.sessionId.trim()
	if (trimmed.length === 0) {
		return Option.none()
	}
	return Option.some(trimmed)
}
