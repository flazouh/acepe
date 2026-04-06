import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const componentSource = readFileSync(
	resolve(import.meta.dir, "./attention-queue-subagent-card.svelte"),
	"utf8"
);
const attentionQueueIndexSource = readFileSync(resolve(import.meta.dir, "./index.ts"), "utf8");
const rootUiIndexSource = readFileSync(resolve(import.meta.dir, "../../index.ts"), "utf8");

describe("attention queue subagent card contract", () => {
	it("uses the shared task header, latest tool row, and tally primitives", () => {
		expect(componentSource).toContain("Robot");
		expect(componentSource).toContain("AgentToolRow");
		expect(componentSource).toContain("ToolTally");
		expect(componentSource).toContain('iconBasePath="/svgs/icons"');
		expect(componentSource).toContain('data-testid="queue-subagent-card"');
	});

	it("is exported from the UI package for desktop and website reuse", () => {
		expect(attentionQueueIndexSource).toContain("AttentionQueueSubagentCard");
		expect(rootUiIndexSource).toContain("AttentionQueueSubagentCard");
	});
});