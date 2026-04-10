import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const agentPanelPath = resolve(__dirname, "../agent-panel.svelte");
const source = readFileSync(agentPanelPath, "utf8");

describe("agent panel tab switch follow override", () => {
	it("forces scroll-to-bottom when returning to the panel", () => {
		expect(source).toContain("function scrollToBottomOnTabSwitch() {");
		expect(source).toContain("contentRef?.scrollToBottom({ force: true });");
		expect(source).not.toContain("contentRef?.scrollToBottom();");
	});
});
