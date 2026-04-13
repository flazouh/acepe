import { describe, expect, it } from "bun:test";

import type { ToolCall } from "$lib/acp/types/tool-call.js";

import { resolveCompactToolDisplay, resolveFullToolEntry } from "../tool-definition-registry.js";
import { resolveToolOperation } from "../resolve-tool-operation.js";

function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
	const base: ToolCall = {
		id: "tool-question-1",
		name: "ask_user",
		kind: "question",
		arguments: { kind: "other", raw: { question: "Ship this change?" } },
		status: "in_progress",
		result: null,
		title: null,
		locations: null,
		skillMeta: null,
		normalizedQuestions: [
			{
				question: "Ship this change?",
				header: "Approval",
				options: [
					{ label: "Yes", description: "Proceed" },
					{ label: "No", description: "Stop" },
				],
				multiSelect: false,
			},
		],
		normalizedTodos: null,
		parentToolUseId: null,
		taskChildren: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
		startedAtMs: 1,
		completedAtMs: undefined,
	};

	if (!overrides) {
		return base;
	}

	return Object.assign({}, base, overrides);
}

describe("operation interaction parity contract", () => {
	it("preserves canonical question semantics across route and shared entry builders", () => {
		const toolCall = createToolCall();

		const operation = resolveToolOperation(toolCall, null);
		const fullEntry = resolveFullToolEntry({ toolCall, turnState: "streaming" });
		const compactDisplay = resolveCompactToolDisplay({ toolCall, turnState: "streaming" });

		expect(operation.resolvedKind).toBe("question");
		expect(operation.routeKey).toBe("question");
		expect(fullEntry.kind).toBe("question");
		expect(fullEntry.question).toEqual({
			question: "Ship this change?",
			header: "Approval",
			options: [
				{ label: "Yes", description: "Proceed" },
				{ label: "No", description: "Stop" },
			],
			multiSelect: false,
		});
		expect(compactDisplay.kind).toBe("question");
	});
});
