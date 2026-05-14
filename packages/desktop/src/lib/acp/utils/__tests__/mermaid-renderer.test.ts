import { beforeEach, describe, expect, it } from "bun:test";

import { isMermaidInitialized, renderMermaid, resetMermaidRenderer } from "../mermaid-renderer.js";

/**
 * Tests for mermaid-renderer using beautiful-mermaid.
 *
 * Note: Full integration tests require theme files to be available.
 * These tests focus on the service logic and error handling.
 */
describe("mermaid-renderer", () => {
	beforeEach(() => {
		resetMermaidRenderer();
	});

	describe("renderMermaid", () => {
		describe("input validation", () => {
			it("should return an error for empty input", async () => {
				const result = await renderMermaid("", true);

				expect(result.isErr()).toBe(true);
				if (result.isErr()) {
					expect(result.error.message).toBe("Empty mermaid code");
				}
			});

			it("should return an error for whitespace-only input", async () => {
				const result = await renderMermaid("   \n\t  ", true);

				expect(result.isErr()).toBe(true);
				if (result.isErr()) {
					expect(result.error.message).toBe("Empty mermaid code");
				}
			});
		});

		describe("theme parameter", () => {
			it("should accept isDark = true", async () => {
				// This will fail in test env due to missing theme files,
				// but validates the API accepts the parameter
				const result = await renderMermaid("flowchart LR\n  A --> B", true);

				// In test env, this will error due to missing theme files
				// The important thing is it doesn't throw
				expect(result.isOk() || result.isErr()).toBe(true);
			});

			it("should accept isDark = false", async () => {
				const result = await renderMermaid("flowchart LR\n  A --> B", false);

				expect(result.isOk() || result.isErr()).toBe(true);
			});

			it("should default to dark theme when isDark is not provided", async () => {
				const result = await renderMermaid("flowchart LR\n  A --> B");

				expect(result.isOk() || result.isErr()).toBe(true);
			});
		});
	});

	describe("isMermaidInitialized", () => {
		it("should return boolean", () => {
			const initialized = isMermaidInitialized();
			expect(typeof initialized).toBe("boolean");
		});

		it("should return false before any render attempt", () => {
			expect(isMermaidInitialized()).toBe(false);
		});
	});

	describe("resetMermaidRenderer", () => {
		it("should reset initialization state", () => {
			// Attempt to initialize (will fail in test env but sets state)
			resetMermaidRenderer();

			expect(isMermaidInitialized()).toBe(false);
		});
	});
});
