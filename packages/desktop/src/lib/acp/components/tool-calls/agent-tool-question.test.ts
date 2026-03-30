import { readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

const AGENT_TOOL_QUESTION_SOURCE = readFileSync(
	new URL(
		"../../../../../../ui/src/components/agent-panel/agent-tool-question.svelte",
		import.meta.url
	),
	"utf8"
);

describe("agent-tool-question source", () => {
	it("shows the Enter submit affordance and forwards freeform keydown events", () => {
		expect(AGENT_TOOL_QUESTION_SOURCE).toContain('aria-label="Press Enter to submit"');
		expect(AGENT_TOOL_QUESTION_SOURCE).toContain(
			"onOtherKeydown?.(qIndex, e.key, question.multiSelect)"
		);
	});

	it("uses the filled question icon for pending and answered states", () => {
		expect(AGENT_TOOL_QUESTION_SOURCE).toContain("IconHelpCircleFilled");
		expect(AGENT_TOOL_QUESTION_SOURCE).toContain("text-primary");
		expect(AGENT_TOOL_QUESTION_SOURCE).toContain("text-success");
		expect(AGENT_TOOL_QUESTION_SOURCE).not.toContain("CheckCircle");
	});
});