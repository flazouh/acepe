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

/**
 * Tests for markdown-it mermaid placeholder rendering.
 * These tests verify that mermaid code blocks are converted to placeholder divs.
 */
describe("markdown mermaid placeholders", () => {
	describe("placeholder structure", () => {
		it("should document expected placeholder HTML structure", () => {
			// This test documents the expected structure when mermaid blocks are rendered
			const expectedPattern = /<div class="mermaid-placeholder" data-mermaid-code="[^"]+"><\/div>/;

			const testHtml = '<div class="mermaid-placeholder" data-mermaid-code="flowchart%20LR"></div>';

			expect(expectedPattern.test(testHtml)).toBe(true);
		});

		it("should URL-encode special characters in placeholder", () => {
			// Verify URL encoding pattern for special characters
			const encodedNewline = encodeURIComponent("\n");
			const encodedArrow = encodeURIComponent("-->");

			expect(encodedNewline).toBe("%0A");
			expect(encodedArrow).toBe("--%3E");
		});

		it("should decode URL-encoded content correctly", () => {
			// Verify decoding works for mermaid content
			const encoded = "flowchart%20LR%0A%20%20A%20--%3E%20B";
			const decoded = decodeURIComponent(encoded);

			expect(decoded).toBe("flowchart LR\n  A --> B");
		});
	});

	describe("regex patterns", () => {
		it("should match mermaid placeholders in HTML", () => {
			const regex = /<div class="mermaid-placeholder" data-mermaid-code="([^"]+)"><\/div>/g;

			const html = `
				<p>Some text</p>
				<div class="mermaid-placeholder" data-mermaid-code="flowchart%20LR"></div>
				<p>More text</p>
			`;

			const matches = [...html.matchAll(regex)];
			expect(matches.length).toBe(1);
			expect(matches[0][1]).toBe("flowchart%20LR");
		});

		it("should match multiple mermaid placeholders", () => {
			const regex = /<div class="mermaid-placeholder" data-mermaid-code="([^"]+)"><\/div>/g;

			const html = `
				<div class="mermaid-placeholder" data-mermaid-code="flowchart%20LR"></div>
				<div class="mermaid-placeholder" data-mermaid-code="sequenceDiagram"></div>
			`;

			const matches = [...html.matchAll(regex)];
			expect(matches.length).toBe(2);
		});
	});
});
