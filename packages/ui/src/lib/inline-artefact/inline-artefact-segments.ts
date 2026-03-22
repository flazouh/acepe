import { Result } from "neverthrow";

export type InlineArtefactTokenType = "file" | "image" | "text" | "text_ref" | "command" | "skill";

export type InlineArtefactSegment =
	| { kind: "text"; text: string }
	| {
			kind: "artefact";
			tokenType: InlineArtefactTokenType;
			value: string;
			label: string;
			charCount?: number;
			title?: string;
			start: number;
			end: number;
			token: string;
	  };

/** Prefix that opens every inline artefact token (`@[type:value]`). */
export const INLINE_TOKEN_PREFIX = "@[";

const INLINE_ARTEFACT_PATTERN = String.raw`@\[(file|image|text|text_ref|command|skill):([^\]]+)\]`;
const INLINE_ARTEFACT_REGEX = new RegExp(INLINE_ARTEFACT_PATTERN, "g");
const INLINE_TEXT_PREVIEW_LIMIT = 24;
const INLINE_TEXT_TITLE_LIMIT = 500;

const decodeInlineTextTokenValue = Result.fromThrowable(
	(value: string) => decodeURIComponent(escape(atob(value))),
	() => new Error("Invalid inline text token")
);

function truncateInlineText(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars)}…`;
}

function summarizeInlineTextToken(
	value: string
): { label: string; charCount: number; title: string } | null {
	const decoded = decodeInlineTextTokenValue(value);
	if (decoded.isErr()) {
		return null;
	}

	const content = decoded.value;
	const firstLine = content.split("\n")[0] || "";
	const label = firstLine.length > 0
		? truncateInlineText(firstLine, INLINE_TEXT_PREVIEW_LIMIT)
		: "Pasted text";

	return {
		label,
		charCount: content.length,
		title: truncateInlineText(content, INLINE_TEXT_TITLE_LIMIT),
	};
}

function toPresentation(
	tokenType: InlineArtefactTokenType,
	value: string
): { label: string; charCount?: number; title?: string } {
	if (tokenType === "text") {
		const inlineText = summarizeInlineTextToken(value);
		if (inlineText) {
			return inlineText;
		}
		return { label: "Pasted text" };
	}
	if (tokenType === "text_ref") {
		return { label: "Pasted text" };
	}
	if (tokenType === "command") {
		return { label: value };
	}
	if (tokenType === "skill") {
		return { label: value.startsWith("/") ? value.slice(1) : value };
	}

	const fileName = value.split("/").pop();
	return { label: fileName && fileName.length > 0 ? fileName : value };
}

export function tokenizeInlineArtefacts(text: string): InlineArtefactSegment[] {
	if (text.length === 0) {
		return [{ kind: "text", text: "" }];
	}

	const segments: InlineArtefactSegment[] = [];
	let cursor = 0;
	let match = INLINE_ARTEFACT_REGEX.exec(text);

	while (match !== null) {
		const fullToken = match[0];
		const tokenType = match[1] as InlineArtefactTokenType;
		const value = match[2];
		const start = match.index;
		const end = start + fullToken.length;

		if (start > cursor) {
			segments.push({ kind: "text", text: text.slice(cursor, start) });
		}

		segments.push({
			kind: "artefact",
			tokenType,
			value,
			...toPresentation(tokenType, value),
			start,
			end,
			token: fullToken,
		});

		cursor = end;
		match = INLINE_ARTEFACT_REGEX.exec(text);
	}

	if (cursor < text.length) {
		segments.push({ kind: "text", text: text.slice(cursor) });
	}

	return segments.length > 0 ? segments : [{ kind: "text", text }];
}

export function findInlineArtefactRangeAtPosition(
	text: string,
	position: number
): { start: number; end: number } | null {
	if (position < 0 || position > text.length) {
		return null;
	}

	// Use a fresh regex instance to avoid shared lastIndex state, and
	// short-circuit as soon as we pass the target position.
	const regex = new RegExp(INLINE_ARTEFACT_PATTERN, "g");
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (position >= start && position < end) {
			return { start, end };
		}
		if (start > position) {
			break;
		}
	}
	return null;
}
