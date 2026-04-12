import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const kanbanCardPath = resolve(
	import.meta.dir,
	"../../../../../../../ui/src/components/kanban/kanban-card.svelte"
);

describe("kanban card null guards", () => {
	it("captures nullable tool and task branches in stable locals before reading nested fields", () => {
		const source = readFileSync(kanbanCardPath, "utf8");

		expect(source).toContain("{@const taskCard = card.taskCard}");
		expect(source).toContain("description={taskCard.summary}");
		expect(source).toContain('status={taskCard.isStreaming ? "running" : "done"}');
		expect(source).toContain("children={taskCard.toolCalls}");
		expect(source).toContain("{@const latestTool = card.latestTool}");
		expect(source).toContain("<AgentCompactToolDisplay tool={latestTool} />");
		expect(source).not.toContain("description={card.taskCard.summary}");
		expect(source).not.toContain("status={card.taskCard.isStreaming ? \"running\" : \"done\"}");
		expect(source).not.toContain("children={card.taskCard.toolCalls}");
		expect(source).not.toContain("<AgentCompactToolDisplay tool={card.latestTool} />");
	});
});
