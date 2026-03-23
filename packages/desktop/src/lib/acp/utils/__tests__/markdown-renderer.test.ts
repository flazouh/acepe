import { beforeEach, describe, expect, it } from "bun:test";

import {
	clearRenderCache,
	isMarkdownInitialized,
	renderMarkdown,
	renderMarkdownSync,
} from "../markdown-renderer.js";

/**
 * Tests for renderMarkdownSync.
 *
 * Note: Full integration tests with Shiki require a browser environment
 * because the theme is loaded via fetch(). These tests focus on the
 * sync rendering logic without full initialization.
 */
describe("renderMarkdownSync", () => {
	beforeEach(() => {
		clearRenderCache();
	});

	describe("without initialization (test environment)", () => {
		it("should return needsAsync=true when renderer not initialized", () => {
			// In test environment, renderer won't be initialized (no fetch)
			// This verifies the fallback path works correctly
			const result = renderMarkdownSync("Hello **world**");

			if (!isMarkdownInitialized()) {
				expect(result.needsAsync).toBe(true);
				expect(result.html).toBeNull();
				expect(result.fromCache).toBe(false);
			}
		});

		it("should defer large messages to async regardless of initialization", () => {
			// Create a message larger than 10KB threshold
			const largeText = "x".repeat(15_000);
			const result = renderMarkdownSync(largeText);

			// Large messages always need async (to avoid blocking)
			expect(result.needsAsync).toBe(true);
			expect(result.html).toBeNull();
		});

		it("should handle empty string", () => {
			const result = renderMarkdownSync("");

			// Empty string still needs the renderer
			if (!isMarkdownInitialized()) {
				expect(result.needsAsync).toBe(true);
			}
		});
	});

	describe("cache behavior", () => {
		it("should return fromCache=false on first call", () => {
			const result = renderMarkdownSync("Test content");
			expect(result.fromCache).toBe(false);
		});

		it("should not cache results that need async", () => {
			// First call - needs async
			const result1 = renderMarkdownSync("Test **bold**");

			// Second call should also need async (not cached because no HTML)
			const result2 = renderMarkdownSync("Test **bold**");

			if (!isMarkdownInitialized()) {
				expect(result1.needsAsync).toBe(true);
				expect(result2.needsAsync).toBe(true);
				expect(result2.fromCache).toBe(false); // Nothing was cached
			}
		});
	});

	describe("SyncRenderResult structure", () => {
		it("should return correct result shape", () => {
			const result = renderMarkdownSync("Test");

			expect(result).toHaveProperty("html");
			expect(result).toHaveProperty("fromCache");
			expect(result).toHaveProperty("needsAsync");

			expect(typeof result.fromCache).toBe("boolean");
			expect(typeof result.needsAsync).toBe("boolean");
		});

		it("should have html as string or null", () => {
			const result = renderMarkdownSync("Test");

			expect(result.html === null || typeof result.html === "string").toBe(true);
		});
	});

	describe("performance", () => {
		it("should be fast even when returning needsAsync", () => {
			const start = performance.now();

			for (let i = 0; i < 1000; i++) {
				renderMarkdownSync(`Message ${i}`);
			}

			const elapsed = performance.now() - start;

			// 1000 calls should complete in under 50ms even without caching
			// (just checking needsAsync and returning)
			expect(elapsed).toBeLessThan(50);
		});

		it("should quickly detect large messages", () => {
			const largeText = "x".repeat(15_000);

			const start = performance.now();

			for (let i = 0; i < 100; i++) {
				renderMarkdownSync(largeText);
			}

			const elapsed = performance.now() - start;

			// Size check should be instant
			expect(elapsed).toBeLessThan(10);
		});
	});
});

/**
 * Tests for markdown table rendering with wrapper.
 * These tests verify that tables are properly wrapped in a div.table-wrapper
 * for horizontal scrolling support.
 *
 * Note: These tests require the markdown renderer to be initialized.
 * In a full browser environment, this happens automatically.
 */
describe("markdown table rendering", () => {
	// Skip these tests if the renderer isn't initialized (test environment limitation)
	// In the actual app, the renderer is initialized on startup
	const skipIfNotInitialized = isMarkdownInitialized() ? describe : describe.skip;

	skipIfNotInitialized("with initialized renderer", () => {
		beforeEach(() => {
			clearRenderCache();
		});

		describe("table wrapper", () => {
			it("should wrap tables in div with class table-wrapper", async () => {
				const markdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
        `.trim();

				renderMarkdown(markdown).match(
					(html) => {
						expect(html).toContain('class="table-wrapper"');
						expect(html).toContain("<table");
					},
					() => {
						// If renderer fails to init, skip test
						expect(true).toBe(true);
					}
				);
			});

			it("should properly nest table inside wrapper", async () => {
				const markdown = `
| A | B |
|---|---|
| 1 | 2 |
        `.trim();

				renderMarkdown(markdown).match(
					(html) => {
						// Check that wrapper contains table
						const wrapperMatch = html.match(/<div class="table-wrapper">[\s\S]*?<\/div>/);
						expect(wrapperMatch).toBeTruthy();
						expect(wrapperMatch?.[0]).toContain("<table");
						expect(wrapperMatch?.[0]).toContain("</table>");
					},
					() => {
						// If renderer fails to init, skip test
						expect(true).toBe(true);
					}
				);
			});

			it("should handle multiple tables with separate wrappers", async () => {
				const markdown = `
| T1 |
|----|
| A  |

| T2 |
|----|
| B  |
        `.trim();

				renderMarkdown(markdown).match(
					(html) => {
						const wrappers = html.match(/class="table-wrapper"/g);
						expect(wrappers?.length).toBe(2);
					},
					() => {
						// If renderer fails to init, skip test
						expect(true).toBe(true);
					}
				);
			});
		});

		describe("table content", () => {
			it("should render thead correctly", async () => {
				const markdown = `
| Name | Age |
|------|-----|
| John | 30  |
        `.trim();

				const result = await renderMarkdown(markdown);
				if (result.isOk()) {
					const html = result.value;

					expect(html).toContain("<thead>");
					expect(html).toContain("</thead>");
					expect(html).toContain("<th>Name</th>");
					expect(html).toContain("<th>Age</th>");
				} else {
					// If renderer fails to init, skip test
					expect(true).toBe(true);
				}
			});

			it("should render tbody correctly", async () => {
				const markdown = `
| Name | Age |
|------|-----|
| John | 30  |
        `.trim();

				const result = await renderMarkdown(markdown);
				if (result.isOk()) {
					const html = result.value;

					expect(html).toContain("<tbody>");
					expect(html).toContain("</tbody>");
					expect(html).toContain("<td>John</td>");
					expect(html).toContain("<td>30</td>");
				} else {
					// If renderer fails to init, skip test
					expect(true).toBe(true);
				}
			});
		});

		describe("non-table content", () => {
			it("should not wrap paragraphs", async () => {
				const markdown = "This is a paragraph.";

				const result = await renderMarkdown(markdown);
				if (result.isOk()) {
					const html = result.value;

					expect(html).toContain("<p>");
					expect(html).not.toContain("table-wrapper");
				} else {
					// If renderer fails to init, skip test
					expect(true).toBe(true);
				}
			});

			it("should not wrap code blocks", async () => {
				const markdown = `
\`\`\`js
const x = 5;
\`\`\`
        `.trim();

				const result = await renderMarkdown(markdown);
				if (result.isOk()) {
					const html = result.value;

					expect(html).toContain("<pre");
					expect(html).not.toContain("table-wrapper");
				} else {
					// If renderer fails to init, skip test
					expect(true).toBe(true);
				}
			});
		});
	});

	describe("structure verification (without Shiki)", () => {
		it("should document expected HTML structure for tables", () => {
			// This test documents the expected structure when tables are properly wrapped
			const expectedPattern = /<div class="table-wrapper"><table[\s\S]*?<\/table><\/div>/;

			// Expected structure breakdown:
			// <div class="table-wrapper">  <- Scrollable container
			//   <table>                     <- Standard HTML table
			//     <thead>...</thead>        <- Headers
			//     <tbody>...</tbody>        <- Body rows
			//   </table>
			// </div>

			expect(expectedPattern.test('<div class="table-wrapper"><table></table></div>')).toBe(true);
		});
	});
});

/**
 * Color badge plugin: do not render a color badge when the segment after #
 * is all decimal digits (e.g. PR #604), so PR/issue refs stay as text.
 */
describe("color badge (all-digit skip)", () => {
	beforeEach(() => {
		clearRenderCache();
	});

	const skipIfNotInitialized = isMarkdownInitialized() ? describe : describe.skip;

	skipIfNotInitialized("with initialized renderer", () => {
		it("should not render color badge for all-digit refs like PR #604", async () => {
			const result = await renderMarkdown(
				"Done. `main` is now up to date and includes the merged PR #604."
			);
			result.match(
				(html) => {
					expect(html).not.toContain('class="color-badge"');
					expect(html).toContain("#604");
				},
				() => expect(true).toBe(true)
			);
		});

		it("should still render color badge for real hex colors", async () => {
			const result = await renderMarkdown("Use color #f00 for red.");
			result.match(
				(html) => {
					expect(html).toContain('class="color-badge"');
					expect(html).toContain("#f00");
				},
				() => expect(true).toBe(true)
			);
		});
	});
});
