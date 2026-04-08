import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./attention-queue-entry.svelte"), "utf8");

describe("attention queue entry contract", () => {
	it("keeps latest task subagent tool optional for callers that do not render task cards", () => {
		expect(source).toContain("latestTaskSubagentTool?:");
		expect(source).toContain("latestTaskSubagentTool = null");
	});

	it("accepts actual task subagent tool rows for shared queue and kanban rendering", () => {
		expect(source).toContain("taskSubagentTools?: readonly AgentToolEntry[];");
		expect(source).toContain("taskSubagentTools = []");
		expect(source).toContain("<AgentToolTask");
		expect(source).toContain("description={taskWidgetSummary}");
		expect(source).toContain("status={isStreaming ? \"running\" : \"done\"}");
		expect(source).toContain("children={taskWidgetToolCalls}");
		expect(source).toContain("compact={true}");
	});

	it("delegates question rendering to a reusable question card component", () => {
		expect(source).toContain('import AttentionQueueQuestionCard from "./attention-queue-question-card.svelte"');
		expect(source).toContain("<AttentionQueueQuestionCard");
		expect(source).not.toContain("<IconHelpCircle");
		expect(source).not.toContain("currentQuestion.question");
	});
});
