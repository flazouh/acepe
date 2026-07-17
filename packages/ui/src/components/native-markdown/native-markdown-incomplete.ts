/**
 * Auto-close dangling inline markdown at the end of a streaming chunk so partial
 * syntax renders formatted instead of flashing raw markers. Only completes
 * trailing incomplete tokens; complete markup is returned unchanged. CONSERVATIVE:
 * when a case is ambiguous (list markers, intraword underscores), leave it as-is —
 * a wrong auto-close that mangles text is worse than an occasional marker flash.
 */
export function completeIncompleteMarkdown(markdown: string): string {
	if (markdown === "") {
		return markdown;
	}

	const fenceCompleted = completeOpenFence(markdown);
	if (fenceCompleted !== null) {
		return fenceCompleted;
	}

	const codeSpanCompleted = completeOpenInlineCodeSpan(markdown);
	if (codeSpanCompleted !== null) {
		return codeSpanCompleted;
	}

	return completeInlineEmphasisAndLinks(markdown);
}

const FENCE_LINE_PATTERN = /^([ \t]*)(`{3,}|~{3,})/u;

/**
 * Counts fence lines (``` or ~~~ at line start, ignoring leading indentation) to
 * decide whether the document currently sits inside an open fenced code block. An
 * odd count of a given fence character means the last fence opened a block that
 * never closed. Returns the completed string, or `null` if there is no open fence
 * (so inline completion should run instead). Deliberately does not attempt
 * inline completion inside code content.
 */
function completeOpenFence(markdown: string): string | null {
	const lines = markdown.split("\n");
	let openFenceChar: "`" | "~" | null = null;
	let openFenceLength = 0;

	for (const line of lines) {
		const match = FENCE_LINE_PATTERN.exec(line);
		if (match === null) {
			continue;
		}
		const fence = match[2];
		if (fence === undefined) {
			continue;
		}
		const fenceChar = fence[0] === "`" ? "`" : "~";

		if (openFenceChar === null) {
			openFenceChar = fenceChar;
			openFenceLength = fence.length;
			continue;
		}

		// A closing fence must use the same character and be at least as long as
		// the opener (CommonMark rule). Anything else is content, not a fence.
		if (fenceChar === openFenceChar && fence.length >= openFenceLength) {
			openFenceChar = null;
			openFenceLength = 0;
		}
	}

	if (openFenceChar === null) {
		return null;
	}

	const closer = openFenceChar.repeat(3);
	if (markdown.endsWith("\n")) {
		return `${markdown}${closer}`;
	}
	return `${markdown}\n${closer}`;
}

/**
 * Closes a trailing unclosed inline code span (a run of N backticks that opens a
 * span with no matching run of N backticks after it). Content inside an open span
 * is left untouched — no emphasis completion runs inside code. Returns `null` when
 * there is no dangling code span, so inline emphasis/link completion can proceed.
 */
function completeOpenInlineCodeSpan(markdown: string): string | null {
	const backtickRunPattern = /`+/gu;
	let match: RegExpExecArray | null;
	let openRun: { text: string; index: number } | null = null;

	backtickRunPattern.lastIndex = 0;
	while ((match = backtickRunPattern.exec(markdown)) !== null) {
		if (isEscaped(markdown, match.index)) {
			continue;
		}
		const run = match[0];
		if (openRun === null) {
			openRun = { text: run, index: match.index };
			continue;
		}
		if (run.length === openRun.text.length) {
			// This run closes the open span.
			openRun = null;
		}
		// A run of a different length inside an open span is just more code
		// content (CommonMark rule) — keep the same span open.
	}

	if (openRun === null) {
		return null;
	}

	return `${markdown}${openRun.text}`;
}

function isEscaped(text: string, index: number): boolean {
	let backslashCount = 0;
	let cursor = index - 1;
	while (cursor >= 0 && text[cursor] === "\\") {
		backslashCount += 1;
		cursor -= 1;
	}
	return backslashCount % 2 === 1;
}

const WORD_CHAR_PATTERN = /[\p{L}\p{N}_]/u;

function completeInlineEmphasisAndLinks(markdown: string): string {
	// Markers inside a COMPLETE inline-code span (`` `...` `` / `` ``...`` ``)
	// are literal code, not emphasis syntax, and must not be counted. Mask them
	// out to a same-length run of spaces for detection purposes only — every
	// completion below appends its closer to the ORIGINAL string, so the actual
	// code span content and length are preserved untouched in the output.
	const masked = maskCompleteInlineCodeSpans(markdown);

	const linkCompleted = completeDanglingLink(masked, markdown);
	if (linkCompleted !== null) {
		return linkCompleted;
	}

	const strongCompleted = completeTrailingRunMarker(masked, markdown, "**");
	if (strongCompleted !== null) {
		return strongCompleted;
	}

	const strongUnderscoreCompleted = completeTrailingRunMarker(
		masked,
		markdown,
		"__",
	);
	if (strongUnderscoreCompleted !== null) {
		return strongUnderscoreCompleted;
	}

	const strikeCompleted = completeTrailingRunMarker(masked, markdown, "~~");
	if (strikeCompleted !== null) {
		return strikeCompleted;
	}

	const italicCompleted = completeTrailingSingleEmphasisMarker(
		masked,
		markdown,
	);
	if (italicCompleted !== null) {
		return italicCompleted;
	}

	return markdown;
}

/**
 * Replaces every COMPLETE inline-code span (a backtick run, its content, and
 * the matching closing run of the same length) with same-length whitespace,
 * so emphasis/link counting below never sees markers that are really code
 * content. By the time this runs, `completeOpenInlineCodeSpan` has already
 * returned early for any string with a dangling (unclosed) code span, so
 * every backtick run encountered here is guaranteed to pair up.
 */
function maskCompleteInlineCodeSpans(markdown: string): string {
	const backtickRunPattern = /`+/gu;
	let match: RegExpExecArray | null;
	let openRun: { text: string; index: number } | null = null;
	const chars = markdown.split("");

	backtickRunPattern.lastIndex = 0;
	while ((match = backtickRunPattern.exec(markdown)) !== null) {
		if (isEscaped(markdown, match.index)) {
			continue;
		}
		const run = match[0];
		if (openRun === null) {
			openRun = { text: run, index: match.index };
			continue;
		}
		if (run.length === openRun.text.length) {
			const spanEnd = match.index + run.length;
			for (let index = openRun.index; index < spanEnd; index += 1) {
				chars[index] = " ";
			}
			openRun = null;
		}
		// A run of a different length inside an open span is more code content
		// (CommonMark rule) — keep the same span open, nothing to mask yet.
	}

	return chars.join("");
}

/**
 * Handles a trailing `[label](url` with no closing `)`, and a trailing `[label`
 * with no closing `]` at all. Conservative: only triggers when the last `[` (not
 * inside a list marker context) has no matching close before the end of string.
 * `text` (code-span-masked) drives detection; `original` is the unmasked string
 * the returned value is built from, so masked-out code content is preserved.
 */
function completeDanglingLink(text: string, original: string): string | null {
	const lastOpenParenLinkMatch = /\[([^[\]]*)\]\(([^()]*)$/u.exec(text);
	if (lastOpenParenLinkMatch !== null) {
		// Close the URL paren. Even a partial/empty href renders inert rather
		// than leaving a raw, unbalanced `(` in the text.
		return `${original})`;
	}

	const lastBracketIndex = findLastUnescapedIndex(text, "[");
	if (lastBracketIndex === -1) {
		return null;
	}

	// If there's a matching closing bracket after it, the label is complete;
	// nothing to do here (a dangling `](` case is already handled above, and a
	// fully closed `[label](url)` needs no completion at all).
	const closingBracketIndex = findUnescapedIndexFrom(
		text,
		"]",
		lastBracketIndex + 1,
	);
	if (closingBracketIndex !== -1) {
		return null;
	}

	// Trailing `[` with no closing bracket at all: close the label so no raw
	// bracket is left dangling, and add an empty inert URL.
	return `${original}]()`;
}

function findLastUnescapedIndex(text: string, char: string): number {
	for (let index = text.length - 1; index >= 0; index -= 1) {
		if (text[index] === char && !isEscaped(text, index)) {
			return index;
		}
	}
	return -1;
}

function findUnescapedIndexFrom(
	text: string,
	char: string,
	fromIndex: number,
): number {
	for (let index = fromIndex; index < text.length; index += 1) {
		if (text[index] === char && !isEscaped(text, index)) {
			return index;
		}
	}
	return -1;
}

/**
 * Closes a trailing unmatched `**`/`__`/`~~` run marker. Counts unescaped
 * occurrences of the marker in `text` (code-span-masked); an odd count means
 * the last one opened a span that never closed, so append the marker to
 * `original` to close it.
 */
function completeTrailingRunMarker(
	text: string,
	original: string,
	marker: "**" | "__" | "~~",
): string | null {
	let count = 0;
	let searchFrom = 0;
	while (true) {
		const index = text.indexOf(marker, searchFrom);
		if (index === -1) {
			break;
		}
		if (!isEscaped(text, index)) {
			count += 1;
		}
		searchFrom = index + marker.length;
	}

	if (count % 2 === 0) {
		return null;
	}

	return `${original}${marker}`;
}

/**
 * Closes a trailing unmatched single `*` or `_` emphasis opener. Very
 * conservative: only closes when the LAST unescaped occurrence of the marker in
 * the string is unambiguously an emphasis opener (not a list marker, not
 * surrounded by spaces, and — for `_` — at a word boundary, not intraword).
 * Any doubt leaves the string unchanged, per the module's conservative contract.
 */
function completeTrailingSingleEmphasisMarker(
	text: string,
	original: string,
): string | null {
	for (const marker of ["*", "_"] as const) {
		const result = completeTrailingSingleMarkerFor(text, original, marker);
		if (result !== null) {
			return result;
		}
	}
	return null;
}

function completeTrailingSingleMarkerFor(
	text: string,
	original: string,
	marker: "*" | "_",
): string | null {
	// Collect unescaped occurrences of the bare marker character, but skip ones
	// that are part of a `**`/`__` run (those are handled by the strong-marker
	// pass above, and counting them here would double count).
	const occurrences: number[] = [];
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] !== marker || isEscaped(text, index)) {
			continue;
		}
		const previousChar = text[index - 1];
		const nextChar = text[index + 1];
		if (previousChar === marker || nextChar === marker) {
			// Part of a run (`**`, `***`, etc.) — not a single-emphasis marker.
			continue;
		}
		occurrences.push(index);
	}

	if (occurrences.length % 2 === 0) {
		return null;
	}

	const lastIndex = occurrences[occurrences.length - 1];
	if (lastIndex === undefined) {
		return null;
	}

	if (!isConservativeEmphasisOpener(text, lastIndex, marker)) {
		return null;
	}

	return `${original}${marker}`;
}

function isConservativeEmphasisOpener(
	markdown: string,
	index: number,
	marker: "*" | "_",
): boolean {
	const lineStart = markdown.lastIndexOf("\n", index - 1) + 1;
	const linePrefix = markdown.slice(lineStart, index);

	if (marker === "*") {
		// A `*` at the start of a line (optionally after whitespace) followed by
		// a space is a list marker, not emphasis — never close it.
		if (/^[ \t]*$/u.test(linePrefix) && markdown[index + 1] === " ") {
			return false;
		}

		const previousChar = markdown[index - 1];
		const nextChar = markdown[index + 1];
		// Surrounded by spaces on both sides (or at string edges with a space on
		// the open side) reads as ambiguous — e.g. multiplication ("5 * 3").
		const previousIsSpace =
			previousChar === undefined ||
			previousChar === " " ||
			previousChar === "\n";
		const nextIsSpace =
			nextChar === undefined || nextChar === " " || nextChar === "\n";
		if (previousIsSpace && nextIsSpace) {
			return false;
		}
		// A closing `*` needs non-space text before it (left-flanking rule for
		// the opener); if the char right after the opener is a space, it can't
		// be an opener at all.
		if (nextChar === " " || nextChar === undefined) {
			return false;
		}
		return true;
	}

	// marker === "_": only treat as emphasis at a word boundary — never
	// intraword (GFM rule: `a_b_c` stays literal).
	const previousChar = markdown[index - 1];
	const nextChar = markdown[index + 1];
	const previousIsWord =
		previousChar !== undefined && WORD_CHAR_PATTERN.test(previousChar);
	const nextIsWord = nextChar !== undefined && WORD_CHAR_PATTERN.test(nextChar);
	if (previousIsWord && nextIsWord) {
		// Intraword underscore — never emphasis.
		return false;
	}
	if (nextChar === " " || nextChar === undefined) {
		return false;
	}
	if (previousIsWord) {
		// Preceded by a word char with no space before it (e.g. `word_open) —
		// this is the closing side of a boundary, ambiguous as an opener; be
		// conservative and skip.
		return false;
	}
	return true;
}
