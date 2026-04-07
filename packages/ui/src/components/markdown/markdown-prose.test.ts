import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./markdown-prose.css"), "utf8");

describe("markdown prose styles", () => {
	it("adds bottom room below scrollable tables", () => {
		expect(source).toContain(".markdown-content .table-wrapper");
		expect(source).toContain("padding-bottom: 0.5rem !important;");
	});

	it("avoids section-level fade during streaming and disables code block animation", () => {
		expect(source).not.toContain(".markdown-content > .streaming-section.streaming-fade-in");
		expect(source).not.toContain("animation: streaming-fade-in 250ms ease;");
		expect(source).toContain(".markdown-content > .streaming-section.streaming-live-refresh");
		expect(source).toContain("animation: streaming-live-refresh 120ms ease-out;");
		expect(source).toContain("opacity: 0.9;");
		expect(source).toContain(".markdown-content > .streaming-section .code-block-wrapper");
		expect(source).toContain("animation: none !important;");
	});
});
