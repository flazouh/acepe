/**
 * Wraps words in the given HTML-token-aware text string with `.sd-word-fade` spans
 * for CSS word-level fade-in animation during live streaming.
 *
 * Design notes:
 * - Text may contain `@@LIVE_MD_N@@` token placeholders (inline HTML tokens from
 *   renderInlineMarkdown). These are treated as atomic units and wrapped whole.
 * - HTML entities (`&amp;`, `&lt;`, etc.) are also treated as atomic tokens so
 *   they pass through intact inside their word span.
 * - Whitespace (spaces, newlines, tabs) is preserved as-is without wrapping.
 * - Uses `Intl.Segmenter` for Unicode-aware word boundary detection (CJK, emoji, etc.),
 *   with a whitespace-split fallback for environments that lack it.
 * - Supports incremental animation via `WordAnimationState`: words before
 *   `animateFrom` are emitted as plain text; words at or after are wrapped
 *   in `.sd-word-fade` spans. This prevents CSS animation restart on
 *   already-visible words during streaming DOM replacement.
 */

const WORD_FADE_CLASS = "sd-word-fade";

/**
 * Mutable state object for tracking word position across multiple
 * `wrapWordsForAnimation` calls within a single section render.
 *
 * - `wordIndex`: current global word position (mutated during wrapping)
 * - `animateFrom`: words at index ≥ this threshold get `.sd-word-fade`
 */
export interface WordAnimationState {
	wordIndex: number;
	readonly animateFrom: number;
}

/**
 * Splits text on protected tokens (@@LIVE_MD_N@@ and HTML entities) while
 * keeping them as separate array elements via the capturing group.
 * E.g. "foo &lt; @@LIVE_MD_0@@" → ["foo ", "&lt;", " ", "@@LIVE_MD_0@@", ""]
 */
const PROTECTED_TOKEN_SPLIT_PATTERN = /(@@LIVE_MD_\d+@@|&[a-zA-Z#][a-zA-Z0-9]*;)/g;

/**
 * Matches a single complete protected token — used to identify token-only chunks
 * after splitting.
 */
const SINGLE_PROTECTED_TOKEN_PATTERN = /^(@@LIVE_MD_\d+@@|&[a-zA-Z#][a-zA-Z0-9]*;)$/;

function wrapWord(word: string): string {
	return `<span class="${WORD_FADE_CLASS}">${word}</span>`;
}

function emitWord(word: string, state: WordAnimationState): string {
	const shouldAnimate = state.wordIndex >= state.animateFrom;
	state.wordIndex++;
	return shouldAnimate ? wrapWord(word) : word;
}

type SegmenterLike = {
	segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

function getSegmenter(): SegmenterLike | null {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		return new (
			Intl as typeof Intl & {
				Segmenter: new (locale: string, opts: { granularity: string }) => SegmenterLike;
			}
		).Segmenter("en", { granularity: "word" });
	}
	return null;
}

/**
 * Segment a plain-text chunk (no protected tokens) and wrap/emit word-like runs.
 */
function segmentTextChunk(
	text: string,
	segmenter: SegmenterLike | null,
	state: WordAnimationState
): string {
	if (text.length === 0) return text;

	let result = "";

	if (segmenter !== null) {
		for (const { segment, isWordLike } of segmenter.segment(text)) {
			if (isWordLike === true) {
				result += emitWord(segment, state);
			} else {
				result += segment;
			}
		}
	} else {
		// Fallback: split on whitespace boundaries.
		const parts = text.split(/(\s+)/);
		for (const part of parts) {
			if (part.length === 0) continue;
			if (/^\s+$/.test(part)) {
				result += part;
			} else {
				result += emitWord(part, state);
			}
		}
	}

	return result;
}

// Lazily create one shared segmenter instance.
let _segmenter: SegmenterLike | null | undefined = undefined;

function getSharedSegmenter(): SegmenterLike | null {
	if (_segmenter === undefined) {
		_segmenter = getSegmenter();
	}
	return _segmenter;
}

function wrapSegments(
	text: string,
	segmenter: SegmenterLike | null,
	state: WordAnimationState
): string {
	// Split on protected tokens (entities and placeholders), keeping them as chunks.
	const chunks = text.split(PROTECTED_TOKEN_SPLIT_PATTERN);
	let result = "";

	for (const chunk of chunks) {
		if (chunk.length === 0) continue;

		if (SINGLE_PROTECTED_TOKEN_PATTERN.test(chunk)) {
			// Protected token — emit as atomic word unit.
			result += emitWord(chunk, state);
		} else {
			// Plain text chunk — segment by word boundary.
			result += segmentTextChunk(chunk, segmenter, state);
		}
	}

	return result;
}

/**
 * Wraps each word in `text` with `<span class="sd-word-fade">word</span>`,
 * respecting `state` for incremental animation tracking.
 *
 * @param text - HTML-entity-escaped text that may contain `@@LIVE_MD_N@@` placeholders.
 * @param state - Optional mutable tracker. Words at index < `state.animateFrom` are
 *   emitted as plain text (no animation). When omitted, all words are animated.
 * @returns HTML string with words wrapped in `.sd-word-fade` spans. Whitespace is preserved.
 */
export function wrapWordsForAnimation(text: string, state?: WordAnimationState): string {
	if (text.length === 0) return text;
	if (/^\s+$/.test(text)) return text;
	const effectiveState: WordAnimationState = state ?? { wordIndex: 0, animateFrom: 0 };
	return wrapSegments(text, getSharedSegmenter(), effectiveState);
}

/**
 * Exported for testing only — allows injecting a controlled segmenter (or null for fallback).
 */
export function wrapWordsForAnimationWithSegmenter(
	text: string,
	segmenter: SegmenterLike | null,
	state?: WordAnimationState
): string {
	if (text.length === 0) return text;
	if (/^\s+$/.test(text)) return text;
	const effectiveState: WordAnimationState = state ?? { wordIndex: 0, animateFrom: 0 };
	return wrapSegments(text, segmenter, effectiveState);
}
