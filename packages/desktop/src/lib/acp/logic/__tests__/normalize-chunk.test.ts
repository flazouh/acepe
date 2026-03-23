import { describe, expect, it } from "bun:test";

import type { ChunkInput } from "../chunk-aggregation-types.js";

import { normalizeChunk } from "../normalize-chunk.js";

describe("normalizeChunk", () => {
	// ==========================================
	// Explicit thoughts
	// ==========================================

	describe("explicit thoughts (isThought=true)", () => {
		it("strips [Thinking] prefix from thought text", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: { type: "text", text: "[Thinking] I should read the file." },
				isThought: true,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("thought");
			expect(result.block).toEqual({ type: "text", text: "I should read the file." });
		});

		it("passes through thought without prefix unchanged", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: { type: "text", text: "Let me think about this." },
				isThought: true,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("thought");
			expect(result.block).toEqual({ type: "text", text: "Let me think about this." });
		});

		it("handles non-text content blocks as thoughts", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: {
					type: "image",
					source: { type: "url", url: "http://example.com/img.png" },
				} as unknown as ChunkInput["content"],
				isThought: true,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("thought");
			// Non-text content passes through unchanged
			expect(result.block).toBe(input.content);
		});
	});

	// ==========================================
	// Implicit thoughts (Cursor agent pattern)
	// ==========================================

	describe("implicit thoughts (message with [Thinking] prefix)", () => {
		it("detects [Thinking] prefix and converts to thought", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: { type: "text", text: "[Thinking] I need to check the database." },
				isThought: false,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("thought");
			expect(result.block).toEqual({ type: "text", text: "I need to check the database." });
		});

		it("detects [thinking] prefix (lowercase)", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: { type: "text", text: "[thinking] lowercase variant" },
				isThought: false,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("thought");
			expect(result.block).toEqual({ type: "text", text: "lowercase variant" });
		});

		it("detects [Thought] prefix variant", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: { type: "text", text: "[Thought] another variant" },
				isThought: false,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("thought");
			expect(result.block).toEqual({ type: "text", text: "another variant" });
		});
	});

	// ==========================================
	// Regular messages
	// ==========================================

	describe("regular messages", () => {
		it("passes through regular text message as-is", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: { type: "text", text: "Hello, how can I help?" },
				isThought: false,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("message");
			expect(result.block).toEqual({ type: "text", text: "Hello, how can I help?" });
		});

		it("does not strip [Thinking] in the middle of text", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: { type: "text", text: "I was [Thinking] about this." },
				isThought: false,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("message");
			expect(result.block).toEqual({ type: "text", text: "I was [Thinking] about this." });
		});

		it("handles non-text content blocks", () => {
			const input: ChunkInput = {
				messageId: "msg-1",
				content: {
					type: "image",
					source: { type: "url", url: "http://example.com/img.png" },
				} as unknown as ChunkInput["content"],
				isThought: false,
			};

			const result = normalizeChunk(input);

			expect(result.type).toBe("message");
			expect(result.block).toBe(input.content);
		});
	});
});
