import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "./agent-panel.svelte"), "utf8");

describe("agent panel footer order", () => {
	it("renders the permission card before the PR and review widgets above the composer", () => {
		const permissionBarIndex = source.indexOf("<PermissionBar");
		const prStatusCardIndex = source.indexOf("<PrStatusCard");
		const modifiedFilesHeaderIndex = source.indexOf("<ModifiedFilesHeader");
		const todoHeaderIndex = source.indexOf("<TodoHeader");
		const queueCardStripIndex = source.indexOf("<QueueCardStrip");
		const agentInputIndex = source.indexOf("<AgentInput");

		expect(permissionBarIndex).toBeGreaterThan(-1);
		expect(prStatusCardIndex).toBeGreaterThan(-1);
		expect(modifiedFilesHeaderIndex).toBeGreaterThan(-1);
		expect(todoHeaderIndex).toBeGreaterThan(-1);
		expect(queueCardStripIndex).toBeGreaterThan(-1);
		expect(agentInputIndex).toBeGreaterThan(-1);

		expect(permissionBarIndex).toBeLessThan(prStatusCardIndex);
		expect(permissionBarIndex).toBeLessThan(modifiedFilesHeaderIndex);
		expect(permissionBarIndex).toBeLessThan(todoHeaderIndex);
		expect(permissionBarIndex).toBeLessThan(queueCardStripIndex);
		expect(permissionBarIndex).toBeLessThan(agentInputIndex);
	});
});
