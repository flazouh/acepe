import { describe, expect, it } from "vitest";

import {
	hasThoughtPrefix,
	stripThoughtPrefix,
	THOUGHT_PREFIXES,
} from "../thought-prefix-stripper.js";

describe("stripThoughtPrefix", () => {
	describe("strips known prefixes", () => {
		it("strips [Thinking] prefix", () => {
			const input = "[Thinking] The user wants to create a new file.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("The user wants to create a new file.");
		});

		it("strips [thinking] prefix (lowercase)", () => {
			const input = "[thinking] analyzing the request";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("analyzing the request");
		});

		it("strips [THINKING] prefix (uppercase)", () => {
			const input = "[THINKING] Processing user input";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("Processing user input");
		});

		it("strips [Thought] prefix", () => {
			const input = "[Thought] I should check the file first.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("I should check the file first.");
		});

		it("strips [thought] prefix (lowercase)", () => {
			const input = "[thought] need to read the documentation";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("need to read the documentation");
		});
	});

	describe("preserves text without prefixes", () => {
		it("returns text unchanged when no prefix present", () => {
			const input = "This is a normal thought without prefix.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("This is a normal thought without prefix.");
		});

		it("returns empty string unchanged", () => {
			const result = stripThoughtPrefix("");
			expect(result).toBe("");
		});

		it("preserves whitespace-only text", () => {
			const result = stripThoughtPrefix("   ");
			expect(result).toBe("   ");
		});
	});

	describe("handles edge cases", () => {
		it("only strips prefix at the beginning of text", () => {
			const input = "Some text [Thinking] in the middle.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("Some text [Thinking] in the middle.");
		});

		it("handles prefix with extra whitespace after it", () => {
			const input = "[Thinking]   Multiple spaces after prefix.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("Multiple spaces after prefix.");
		});

		it("handles prefix with no space after it", () => {
			const input = "[Thinking]No space after prefix.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("No space after prefix.");
		});

		it("handles prefix with leading whitespace", () => {
			const input = "  [Thinking] Has leading whitespace.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("Has leading whitespace.");
		});

		it("handles newline after prefix", () => {
			const input = "[Thinking]\nNew line after prefix.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("New line after prefix.");
		});

		it("handles text that is just the prefix", () => {
			const input = "[Thinking]";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("");
		});

		it("handles text that is just the prefix with trailing space", () => {
			const input = "[Thinking] ";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("");
		});
	});

	describe("does not strip similar but different patterns", () => {
		it("preserves [Think] (not a known prefix)", () => {
			const input = "[Think] This should not be stripped.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("[Think] This should not be stripped.");
		});

		it("preserves brackets with different content", () => {
			const input = "[Info] Some information.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("[Info] Some information.");
		});

		it("preserves unclosed brackets", () => {
			const input = "[Thinking Some text without closing bracket.";
			const result = stripThoughtPrefix(input);
			expect(result).toBe("[Thinking Some text without closing bracket.");
		});
	});
});

describe("hasThoughtPrefix", () => {
	it("returns true for text with [Thinking] prefix", () => {
		expect(hasThoughtPrefix("[Thinking] Some thought")).toBe(true);
	});

	it("returns true for text with lowercase [thinking] prefix", () => {
		expect(hasThoughtPrefix("[thinking] analyzing")).toBe(true);
	});

	it("returns true for text with leading whitespace before prefix", () => {
		expect(hasThoughtPrefix("  [Thinking] Has leading whitespace.")).toBe(true);
	});

	it("returns false for text without prefix", () => {
		expect(hasThoughtPrefix("Regular text without prefix")).toBe(false);
	});

	it("returns false for text with prefix in middle", () => {
		expect(hasThoughtPrefix("Some text [Thinking] in middle")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(hasThoughtPrefix("")).toBe(false);
	});

	it("returns false for similar but different patterns", () => {
		expect(hasThoughtPrefix("[Think] Not a known prefix")).toBe(false);
		expect(hasThoughtPrefix("[Info] Some info")).toBe(false);
	});
});

describe("THOUGHT_PREFIXES", () => {
	it("exports the list of known prefixes", () => {
		expect(THOUGHT_PREFIXES).toContain("[Thinking]");
		expect(THOUGHT_PREFIXES).toContain("[thinking]");
		expect(THOUGHT_PREFIXES).toContain("[THINKING]");
		expect(THOUGHT_PREFIXES).toContain("[Thought]");
		expect(THOUGHT_PREFIXES).toContain("[thought]");
	});
});
