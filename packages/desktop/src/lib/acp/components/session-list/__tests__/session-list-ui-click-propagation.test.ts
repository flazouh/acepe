import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sessionListUiPath = resolve(__dirname, "../session-list-ui.svelte");
const source = readFileSync(sessionListUiPath, "utf8");

describe("session list header action click propagation", () => {
	it("stops project-header click propagation for plus icon that opens agent strip", () => {
		// Plus icon wrapper must stop propagation so header expand/collapse doesn't fire when clicking plus.
		expect(source).toContain("e.stopPropagation()");
		expect(source).toContain("projectPathShowingAgentStrip");

		// ProjectHeaderAgentStrip used for agent selection when plus is clicked.
		expect(source).toContain("ProjectHeaderAgentStrip");
	});
});
