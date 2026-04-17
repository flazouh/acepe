import { describe, expect, it } from "vitest";
import {
	wrapWordsForAnimation,
	wrapWordsForAnimationWithSegmenter,
	type WordAnimationState,
} from "../wrap-words-for-animation.js";

// Helper: count occurrences of a substring
function countOccurrences(str: string, sub: string): number {
	let count = 0;
	let pos = 0;
	while ((pos = str.indexOf(sub, pos)) !== -1) {
		count++;
		pos += sub.length;
	}
	return count;
}

// Helper: extract all span contents (values inside .sd-word-fade spans)
function extractSpanContents(html: string): string[] {
	const results: string[] = [];
	const pattern = /<span class="sd-word-fade">([^<]*)<\/span>/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(html)) !== null) {
		results.push(match[1]);
	}
	return results;
}

describe("wrapWordsForAnimation", () => {
	describe("happy path", () => {
		it('wraps two words: "hello world"', () => {
			const result = wrapWordsForAnimation("hello world");
			expect(result).toContain('<span class="sd-word-fade">hello</span>');
			expect(result).toContain('<span class="sd-word-fade">world</span>');
			// Space must be preserved (not inside a span)
			expect(result).not.toMatch(/<span[^>]*>\s/);
		});

		it("preserves all whitespace positions in a multi-word sentence", () => {
			const result = wrapWordsForAnimation("one two three");
			expect(result).toContain('<span class="sd-word-fade">one</span>');
			expect(result).toContain('<span class="sd-word-fade">two</span>');
			expect(result).toContain('<span class="sd-word-fade">three</span>');
			// Spaces are outside spans
			expect(result).not.toMatch(/<span[^>]*> /);
			expect(result).not.toMatch(/ <\/span>/);
		});

		it("wraps a single word in one span", () => {
			const result = wrapWordsForAnimation("hello");
			expect(result).toBe('<span class="sd-word-fade">hello</span>');
		});

		it("preserves multiple consecutive spaces between words", () => {
			const result = wrapWordsForAnimation("foo  bar");
			expect(result).toContain('<span class="sd-word-fade">foo</span>');
			expect(result).toContain('<span class="sd-word-fade">bar</span>');
			// Double space preserved outside spans
			expect(result).toContain("</span>  <span");
		});

		it("preserves newlines between words", () => {
			const result = wrapWordsForAnimation("alpha\nbeta");
			// Words are wrapped (the exact span boundary may split on numbers/letters
			// depending on the segmenter implementation, but the words must be present)
			expect(result).toContain("alpha");
			expect(result).toContain("beta");
			// At least one sd-word-fade span must be present
			expect(result).toContain('class="sd-word-fade"');
			// Newline is preserved
			expect(result).toContain("\n");
		});

		it("produces at least one span per word for multiple words", () => {
			const words = ["alpha", "beta", "gamma", "delta", "epsilon"];
			const text = words.join(" ");
			const result = wrapWordsForAnimation(text);
			// Every word must appear in the output
			for (const word of words) {
				expect(result).toContain(word);
			}
			// Must have at least one span per word
			const spanCount = countOccurrences(result, 'class="sd-word-fade"');
			expect(spanCount).toBeGreaterThanOrEqual(words.length);
		});
	});

	describe("edge cases", () => {
		it("returns empty string for empty input", () => {
			expect(wrapWordsForAnimation("")).toBe("");
		});

		it("returns whitespace unchanged for whitespace-only input", () => {
			expect(wrapWordsForAnimation("   ")).toBe("   ");
			expect(wrapWordsForAnimation("\n")).toBe("\n");
			expect(wrapWordsForAnimation("\t")).toBe("\t");
		});

		it("treats HTML entities as atomic tokens — entity stays whole inside span", () => {
			const result = wrapWordsForAnimation("&amp;");
			// The entity must be wrapped as a whole unit (not split)
			expect(result).toBe('<span class="sd-word-fade">&amp;</span>');
		});

		it("handles mixed text and entities — entity appears inside a span", () => {
			const result = wrapWordsForAnimation("foo &lt; bar");
			expect(result).toContain('<span class="sd-word-fade">foo</span>');
			expect(result).toContain('<span class="sd-word-fade">&lt;</span>');
			expect(result).toContain('<span class="sd-word-fade">bar</span>');
		});

		it("wraps @@LIVE_MD_N@@ placeholder as a whole unit", () => {
			const result = wrapWordsForAnimation("@@LIVE_MD_0@@");
			expect(result).toBe('<span class="sd-word-fade">@@LIVE_MD_0@@</span>');
		});

		it("wraps mixed text and placeholders each in their own span", () => {
			const result = wrapWordsForAnimation("hello @@LIVE_MD_0@@ world");
			expect(result).toContain('<span class="sd-word-fade">hello</span>');
			expect(result).toContain('<span class="sd-word-fade">@@LIVE_MD_0@@</span>');
			expect(result).toContain('<span class="sd-word-fade">world</span>');
		});

		it("wraps each placeholder as exactly one span", () => {
			const result = wrapWordsForAnimation("@@LIVE_MD_1@@");
			expect(countOccurrences(result, 'class="sd-word-fade"')).toBe(1);
			expect(result).toContain("@@LIVE_MD_1@@");
		});

		it("handles multiple placeholders — each in its own span", () => {
			const result = wrapWordsForAnimation("@@LIVE_MD_0@@ @@LIVE_MD_1@@");
			expect(countOccurrences(result, 'class="sd-word-fade"')).toBe(2);
			expect(result).toContain('<span class="sd-word-fade">@@LIVE_MD_0@@</span>');
			expect(result).toContain('<span class="sd-word-fade">@@LIVE_MD_1@@</span>');
		});

		it("handles numeric entity names as atomic tokens", () => {
			const result = wrapWordsForAnimation("&#39;");
			expect(result).toBe('<span class="sd-word-fade">&#39;</span>');
		});
	});

	describe("incremental animation (WordAnimationState)", () => {
		it("animates all words when animateFrom is 0", () => {
			const state: WordAnimationState = { wordIndex: 0, animateFrom: 0 };
			const result = wrapWordsForAnimation("hello world", state);
			expect(result).toContain('<span class="sd-word-fade">hello</span>');
			expect(result).toContain('<span class="sd-word-fade">world</span>');
			expect(state.wordIndex).toBe(2);
		});

		it("skips wrapping for words before animateFrom", () => {
			const state: WordAnimationState = { wordIndex: 0, animateFrom: 1 };
			const result = wrapWordsForAnimation("hello world", state);
			// "hello" is at index 0, below animateFrom — should NOT be wrapped
			expect(result).not.toContain('<span class="sd-word-fade">hello</span>');
			expect(result).toContain("hello");
			// "world" is at index 1, at animateFrom — should be wrapped
			expect(result).toContain('<span class="sd-word-fade">world</span>');
			expect(state.wordIndex).toBe(2);
		});

		it("does not wrap any words when animateFrom exceeds word count", () => {
			const state: WordAnimationState = { wordIndex: 0, animateFrom: 10 };
			const result = wrapWordsForAnimation("hello world", state);
			expect(result).not.toContain('class="sd-word-fade"');
			expect(result).toContain("hello");
			expect(result).toContain("world");
			expect(state.wordIndex).toBe(2);
		});

		it("tracks word index across multiple calls", () => {
			const state: WordAnimationState = { wordIndex: 0, animateFrom: 3 };
			// First call: 2 words (indices 0, 1)
			wrapWordsForAnimation("hello world", state);
			expect(state.wordIndex).toBe(2);
			// Second call: 2 more words (indices 2, 3)
			const result = wrapWordsForAnimation("foo bar", state);
			// "foo" at index 2 < animateFrom(3) — not wrapped
			expect(result).not.toContain('<span class="sd-word-fade">foo</span>');
			expect(result).toContain("foo");
			// "bar" at index 3 >= animateFrom(3) — wrapped
			expect(result).toContain('<span class="sd-word-fade">bar</span>');
			expect(state.wordIndex).toBe(4);
		});

		it("handles placeholder tokens in word index tracking", () => {
			const state: WordAnimationState = { wordIndex: 0, animateFrom: 2 };
			const result = wrapWordsForAnimation("hello @@LIVE_MD_0@@ world", state);
			// "hello" index 0 — not wrapped
			expect(result).not.toContain('<span class="sd-word-fade">hello</span>');
			// @@LIVE_MD_0@@ index 1 — not wrapped
			expect(result).not.toContain('<span class="sd-word-fade">@@LIVE_MD_0@@</span>');
			// "world" index 2 — wrapped
			expect(result).toContain('<span class="sd-word-fade">world</span>');
			expect(state.wordIndex).toBe(3);
		});

		it("preserves whitespace when skipping old words", () => {
			const state: WordAnimationState = { wordIndex: 0, animateFrom: 1 };
			const result = wrapWordsForAnimation("foo  bar", state);
			// Double space must be preserved
			expect(result).toContain("foo  ");
			expect(result).toContain('<span class="sd-word-fade">bar</span>');
		});
	});

	describe("whitespace-fallback segmenter (null segmenter)", () => {
		it("wraps words correctly with null segmenter (fallback path)", () => {
			const result = wrapWordsForAnimationWithSegmenter("hello world", null);
			expect(result).toContain('<span class="sd-word-fade">hello</span>');
			expect(result).toContain('<span class="sd-word-fade">world</span>');
		});

		it("handles empty string with null segmenter", () => {
			expect(wrapWordsForAnimationWithSegmenter("", null)).toBe("");
		});

		it("handles whitespace-only with null segmenter", () => {
			expect(wrapWordsForAnimationWithSegmenter("  ", null)).toBe("  ");
		});

		it("wraps placeholder tokens atomically with null segmenter", () => {
			const result = wrapWordsForAnimationWithSegmenter("hello @@LIVE_MD_0@@ world", null);
			expect(result).toContain('<span class="sd-word-fade">@@LIVE_MD_0@@</span>');
			expect(result).toContain('<span class="sd-word-fade">hello</span>');
			expect(result).toContain('<span class="sd-word-fade">world</span>');
		});

		it("wraps entity tokens atomically with null segmenter", () => {
			const result = wrapWordsForAnimationWithSegmenter("a &gt; b", null);
			expect(result).toContain('<span class="sd-word-fade">a</span>');
			expect(result).toContain('<span class="sd-word-fade">&gt;</span>');
			expect(result).toContain('<span class="sd-word-fade">b</span>');
		});

		it("preserves newlines between words with null segmenter", () => {
			const result = wrapWordsForAnimationWithSegmenter("line1\nline2", null);
			expect(result).toContain('<span class="sd-word-fade">line1</span>');
			expect(result).toContain('<span class="sd-word-fade">line2</span>');
			expect(result).toContain("\n");
		});
	});
});
