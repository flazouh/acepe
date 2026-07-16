import { describe, expect, test } from "bun:test";

import {
	exceedsSyntaxHighlightCap,
	SYNTAX_HIGHLIGHT_MAX_BYTES,
	SYNTAX_HIGHLIGHT_MAX_LINES,
} from "../syntax-highlight-cap.js";

describe("syntax highlight cap", () => {
	test("allows small snippets under the line and byte caps", () => {
		expect(exceedsSyntaxHighlightCap("echo hello")).toBe(false);
		expect(exceedsSyntaxHighlightCap("a\nb\nc")).toBe(false);
	});

	test("rejects content beyond the line cap", () => {
		const lines = Array.from({ length: SYNTAX_HIGHLIGHT_MAX_LINES + 1 }, (_, i) => `line ${i}`);
		expect(exceedsSyntaxHighlightCap(lines.join("\n"))).toBe(true);
	});

	test("rejects content beyond the byte cap", () => {
		const oversized = "x".repeat(SYNTAX_HIGHLIGHT_MAX_BYTES + 1);
		expect(exceedsSyntaxHighlightCap(oversized)).toBe(true);
	});

	test("allows content exactly at the caps", () => {
		const exactLines = Array.from({ length: SYNTAX_HIGHLIGHT_MAX_LINES }, (_, i) => `l${i}`);
		expect(exceedsSyntaxHighlightCap(exactLines.join("\n"))).toBe(false);
		expect(exceedsSyntaxHighlightCap("y".repeat(SYNTAX_HIGHLIGHT_MAX_BYTES))).toBe(false);
	});
});
