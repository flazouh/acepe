import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const entrySource = readFileSync(resolve(import.meta.dir, "./attention-queue-entry.svelte"), "utf8");
const componentPath = resolve(import.meta.dir, "./attention-queue-subagent-card.svelte");
const attentionQueueIndexSource = readFileSync(resolve(import.meta.dir, "./index.ts"), "utf8");
const rootUiIndexSource = readFileSync(resolve(import.meta.dir, "../../index.ts"), "utf8");

describe("attention queue subagent card contract", () => {
	it("replaces the bespoke queue subagent card with the shared compact task card", () => {
		expect(existsSync(componentPath)).toBe(false);
		expect(entrySource).toContain("AgentToolTask");
		expect(entrySource).not.toContain("attention-queue-subagent-card");
		expect(attentionQueueIndexSource).not.toContain("AttentionQueueSubagentCard");
		expect(rootUiIndexSource).not.toContain("AttentionQueueSubagentCard");
	});

	it("renders the shared compact task card with queue-friendly props", () => {
		expect(entrySource).toContain('iconBasePath="/svgs/icons"');
		expect(entrySource).toContain("description={taskWidgetSummary}");
		expect(entrySource).toContain("children={taskWidgetToolCalls}");
		expect(entrySource).toContain("compact={true}");
	});
});
