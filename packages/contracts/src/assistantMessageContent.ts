import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { TranscriptText } from "./baseSchemas.ts"

/**
 * The canonical persisted shape of an assistant message: an ordered sequence
 * of streamed slices, each either reply text or extended thinking. Order is
 * product truth -- thought and text deltas interleave inside one assistant
 * message, and a reopened session must replay them in the order they
 * streamed, exactly as the live transcript rendered them.
 *
 * One definition, used by BOTH folds that grow an assistant message (the
 * contract's sessionSnapshot fold and the server's persisted
 * ProjectionSessionMessages fold) and by the RPC snapshot the desktop
 * hydrates from, so the three can never drift apart.
 */
export const AssistantMessagePartKind = Schema.Literals(["text", "thought"])
export type AssistantMessagePartKind = typeof AssistantMessagePartKind.Type

export const AssistantMessagePart = Schema.Struct({
	kind: AssistantMessagePartKind,
	// TranscriptText, not TrimmedNonEmptyString: a part grows one streamed
	// token at a time, and a trimming schema would eat the trailing space of
	// the token before ("I'll runall three steps.").
	text: TranscriptText,
})
export type AssistantMessagePart = typeof AssistantMessagePart.Type

export const AssistantMessageContent = Schema.Struct({
	parts: Schema.Array(AssistantMessagePart),
})
export type AssistantMessageContent = typeof AssistantMessageContent.Type

// Rows persisted before parts existed hold `{"text": "..."}`. The stored
// decode accepts both shapes; normalizeAssistantContent lifts the legacy one
// into a single text part so every reader sees one model. This is versioned
// decode at the storage boundary, not a reader fallback: nothing ever reads
// the legacy shape past this seam, and every write emits the new shape.
export const StoredAssistantMessageContent = Schema.Union([
	AssistantMessageContent,
	Schema.Struct({ text: TranscriptText }),
])
export type StoredAssistantMessageContent = typeof StoredAssistantMessageContent.Type

export const normalizeAssistantContent = (
	stored: StoredAssistantMessageContent
): AssistantMessageContent =>
	"parts" in stored ? stored : { parts: [{ kind: "text", text: stored.text }] }

/**
 * The one fold that grows an assistant message by a streamed slice: a slice
 * of the same kind as the last part extends it, a kind change starts a new
 * part. This is what keeps a burst of TokenAppended events one text part
 * while a thinking phase in the middle still splits out in order.
 */
export const appendAssistantPart = (
	content: AssistantMessageContent,
	kind: AssistantMessagePartKind,
	text: TranscriptText
): AssistantMessageContent => {
	const last = Arr.last(content.parts)
	if (Option.isSome(last) && last.value.kind === kind) {
		return {
			parts: Arr.map(content.parts, (part, index) =>
				index === content.parts.length - 1 ? { kind, text: `${part.text}${text}` } : part),
		}
	}
	return { parts: Arr.append(content.parts, { kind, text }) }
}

/** The reply the assistant actually said: the text parts, thinking excluded. */
export const assistantReplyText = (content: AssistantMessageContent): string =>
	Arr.join(
		Arr.map(
			Arr.filter(content.parts, (part) => part.kind === "text"),
			(part) => part.text
		),
		""
	)
