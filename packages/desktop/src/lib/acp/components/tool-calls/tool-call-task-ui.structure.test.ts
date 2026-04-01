import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const desktopTaskSource = readFileSync(resolve(import.meta.dir, "./tool-call-task.svelte"), "utf8");
const sharedTaskSource = readFileSync(
	resolve(import.meta.dir, "../../../../../../ui/src/components/agent-panel/agent-tool-task.svelte"),
	"utf8"
);

describe("tool call task UI structure", () => {
	it("opts the subagent task wrapper into a completed-state success icon", () => {
		expect(desktopTaskSource).toContain("showDoneIcon={toolStatus.isSuccess}");
	});

	it("renders the shared completed-state success icon hook in the task card header", () => {
		expect(sharedTaskSource).toContain("showDoneIcon");
		expect(sharedTaskSource).toContain("IconCircleCheckFilled");
		expect(sharedTaskSource).toContain('data-testid="agent-tool-task-success-icon"');
	});
});