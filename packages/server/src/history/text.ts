import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { deriveSessionTitleFromUserInput } from "../persistence/Services/ProjectionSessions.ts"

export const HistoryTextRole = Schema.Literals(["user", "assistant"])
export type HistoryTextRole = typeof HistoryTextRole.Type

export type HistoryTextFact = {
	readonly role: HistoryTextRole
	readonly text: TrimmedNonEmptyString
}

export const JsonTextBlock = Schema.Struct({
	type: Schema.optionalKey(Schema.String),
	text: Schema.optionalKey(Schema.String)
})
export type JsonTextBlock = typeof JsonTextBlock.Type

const JsonTextParts = Schema.Array(Schema.Union([Schema.String, JsonTextBlock]))
const isJsonTextParts = Schema.is(JsonTextParts)

export const JsonTextContent = Schema.Union([Schema.String, JsonTextParts, JsonTextBlock])
export type JsonTextContent = typeof JsonTextContent.Type

const isTitle = Schema.is(TrimmedNonEmptyString)

const untitledConversationTitleValue = Schema.decodeUnknownSync(TrimmedNonEmptyString)(
	"Untitled conversation"
)
const importedProjectTitleValue = Schema.decodeUnknownSync(TrimmedNonEmptyString)("Imported project")

const joinParts = (parts: ReadonlyArray<string>): string => Arr.join(parts, "\n")

const textFromBlock = (block: string | JsonTextBlock): string => {
	if (Predicate.isString(block)) {
		return block
	}
	if (block.type !== undefined && block.type !== "text") {
		return ""
	}
	if (block.text === undefined) {
		return ""
	}
	return block.text
}

export const extractJsonText = (content: JsonTextContent): string => {
	if (Predicate.isString(content)) {
		return content
	}
	if (isJsonTextParts(content)) {
		return joinParts(Arr.filter(Arr.map(content, textFromBlock), (part) => part.length > 0))
	}
	return textFromBlock(content)
}

export const asNonEmptyText = (content: JsonTextContent): Option.Option<TrimmedNonEmptyString> => {
	const trimmed = extractJsonText(content).trim()
	if (isTitle(trimmed) === false) {
		return Option.none()
	}
	return Option.some(trimmed)
}

export const untitledConversationTitle = (): TrimmedNonEmptyString => untitledConversationTitleValue

export const importedProjectTitle = (): TrimmedNonEmptyString => importedProjectTitleValue

export const projectTitleFromWorkspace = (basename: string): TrimmedNonEmptyString => {
	if (isTitle(basename)) {
		return basename
	}
	return importedProjectTitle()
}

export const sessionTitleFromUserText = (
	text: Option.Option<TrimmedNonEmptyString>
): TrimmedNonEmptyString =>
	Option.match(text, {
		onNone: untitledConversationTitle,
		onSome: (value) => {
			const derived = deriveSessionTitleFromUserInput(value)
			if (Option.isNone(derived)) {
				return untitledConversationTitle()
			}
			if (isTitle(derived.value) === false) {
				return untitledConversationTitle()
			}
			return derived.value
		}
	})
