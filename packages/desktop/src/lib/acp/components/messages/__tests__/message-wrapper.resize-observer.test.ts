import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const messageWrapperPath = resolve(__dirname, "../message-wrapper.svelte");
const source = readFileSync(messageWrapperPath, "utf8");

describe("message wrapper resize reveal wiring", () => {
	it("attaches a ResizeObserver for reveal-resize mode", () => {
		expect(source).toContain("observer = new ResizeObserver(() => {");
		expect(source).toContain("if (!nextParams.observeRevealResize) {");
	});

	it("reissues thread follow reveals directly from resize notifications", () => {
		expect(source).toContain("nextParams.controller?.requestReveal(nextParams.entryKey);");
		expect(source).not.toContain("requestLatestReveal(");
	});
});
