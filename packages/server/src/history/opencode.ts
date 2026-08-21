import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { HistoryTextFact } from "./text.ts"
import { asNonEmptyText } from "./text.ts"

export const OpenCodePart = Schema.Struct({
	type: Schema.String,
	text: Schema.optionalKey(Schema.String)
})
export type OpenCodePart = typeof OpenCodePart.Type

export const OpenCodeMessageLine = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	role: Schema.String,
	parts: Schema.Array(OpenCodePart),
	timestamp: Schema.optionalKey(Schema.String)
})
export type OpenCodeMessageLine = typeof OpenCodeMessageLine.Type

export const OpenCodeApiLine = Schema.Struct({
	info: Schema.Struct({
		id: Schema.optionalKey(Schema.String),
		role: Schema.String
	}),
	parts: Schema.Array(OpenCodePart)
})
export type OpenCodeApiLine = typeof OpenCodeApiLine.Type

export const OpenCodeJsonlLine = Schema.Union([OpenCodeMessageLine, OpenCodeApiLine])
export type OpenCodeJsonlLine = typeof OpenCodeJsonlLine.Type

const isTextPart = (part: OpenCodePart): boolean => part.type === "text"

const joinedText = (parts: ReadonlyArray<OpenCodePart>): Option.Option<TrimmedNonEmptyString> => {
	const texts = Arr.filterMap(
		parts,
		Filter.fromPredicateOption((part: OpenCodePart) => {
			if (isTextPart(part) === false || part.text === undefined) {
				return Option.none()
			}
			return asNonEmptyText(part.text)
		})
	)
	if (Arr.isReadonlyArrayNonEmpty(texts) === false) {
		return Option.none()
	}
	return asNonEmptyText(Arr.join(texts, "\n"))
}

const roleAndParts = (
	line: OpenCodeJsonlLine
): {
	readonly role: string
	readonly parts: ReadonlyArray<OpenCodePart>
} => {
	if (Schema.is(OpenCodeApiLine)(line)) {
		return {
			role: line.info.role,
			parts: line.parts
		}
	}
	return {
		role: line.role,
		parts: line.parts
	}
}

export const opencodeFactFromLine = (line: OpenCodeJsonlLine): Option.Option<HistoryTextFact> => {
	const decoded = roleAndParts(line)
	if (decoded.role !== "user" && decoded.role !== "assistant") {
		return Option.none()
	}
	const text = joinedText(decoded.parts)
	if (Option.isNone(text)) {
		return Option.none()
	}
	return Option.some({
		role: decoded.role,
		text: text.value
	})
}
