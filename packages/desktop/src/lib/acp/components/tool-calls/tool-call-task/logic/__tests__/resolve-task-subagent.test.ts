import { describe, expect, it } from "bun:test";
import type { ToolCall } from "$lib/acp/types/tool-call.js";
import type { ToolArguments } from "$lib/services/converted-session-types.js";

import { resolveTaskSubagent } from "../resolve-task-subagent.js";

function createTaskToolCall(argumentsValue: ToolArguments): ToolCall {
	return {
		id: "tool-task-1",
		name: "Task",
		arguments: argumentsValue,
		status: "pending",
		kind: "task",
		title: "Task",
		locations: null,
		skillMeta: null,
		result: null,
		awaitingPlanApproval: false,
	};
}

describe("resolveTaskSubagent", () => {
	it("returns base think arguments when streaming arguments are absent", () => {
		const toolCall = createTaskToolCall({
			kind: "think",
			subagent_type: "codebase-researcher",
			description: "Analyze architecture",
			prompt: "Find where task reconciliation happens",
		});

		const result = resolveTaskSubagent(toolCall, undefined);

		expect(result).toEqual({
			subagentType: "codebase-researcher",
			description: "Analyze architecture",
			prompt: "Find where task reconciliation happens",
		});
	});

	it("uses streaming think arguments for progressive title/prompt display", () => {
		const toolCall = createTaskToolCall({
			kind: "think",
			subagent_type: null,
			description: null,
			prompt: null,
		});

		const streamingArgs: ToolArguments = {
			kind: "think",
			subagent_type: "agent-native-reviewer",
			description: "Review for agent parity",
			prompt: "Ensure all user actions are available to agents",
		};

		const result = resolveTaskSubagent(toolCall, streamingArgs);

		expect(result).toEqual({
			subagentType: "agent-native-reviewer",
			description: "Review for agent parity",
			prompt: "Ensure all user actions are available to agents",
		});
	});

	it("merges partial streaming fields with existing base fields", () => {
		const toolCall = createTaskToolCall({
			kind: "think",
			subagent_type: "base-agent",
			description: "Base description",
			prompt: "Base prompt",
		});

		const streamingArgs: ToolArguments = {
			kind: "think",
			description: "Streaming description",
		};

		const result = resolveTaskSubagent(toolCall, streamingArgs);

		expect(result).toEqual({
			subagentType: "base-agent",
			description: "Streaming description",
			prompt: "Base prompt",
		});
	});

	it("ignores non-think streaming arguments", () => {
		const toolCall = createTaskToolCall({
			kind: "think",
			subagent_type: "task-agent",
			description: "Base description",
			prompt: "Base prompt",
		});

		const streamingArgs: ToolArguments = {
			kind: "edit",
			edits: [{ type: "writeFile", file_path: "/tmp/test.md", previous_content: null, content: "# not a task"  }],
		};

		const result = resolveTaskSubagent(toolCall, streamingArgs);

		expect(result).toEqual({
			subagentType: "task-agent",
			description: "Base description",
			prompt: "Base prompt",
		});
	});

	it("returns null when neither base nor streaming arguments are think kind", () => {
		const toolCall = createTaskToolCall({
			kind: "execute",
			command: "echo test",
		});

		const streamingArgs: ToolArguments = {
			kind: "read",
			file_path: "/tmp/a.txt",
		};

		const result = resolveTaskSubagent(toolCall, streamingArgs);

		expect(result).toBeNull();
	});

	it("replays think tool sequence: empty base -> streaming prompt -> full base", () => {
		const initialToolCall = createTaskToolCall({
			kind: "think",
			subagent_type: null,
			description: null,
			prompt: null,
		});

		const streamingArgs: ToolArguments = {
			kind: "think",
			subagent_type: "agent-native-reviewer",
			description: "Audit new workflow",
			prompt: "Check whether tool interactions are agent-accessible",
		};

		// While the base tool call is still empty, UI should still show streaming data.
		const duringStreaming = resolveTaskSubagent(initialToolCall, streamingArgs);
		expect(duringStreaming).toEqual({
			subagentType: "agent-native-reviewer",
			description: "Audit new workflow",
			prompt: "Check whether tool interactions are agent-accessible",
		});

		const finalToolCall = createTaskToolCall({
			kind: "think",
			subagent_type: "agent-native-reviewer",
			description: "Audit new workflow",
			prompt: "Check whether tool interactions are agent-accessible",
		});

		// After full payload arrives, result should remain consistent.
		const afterFullPayload = resolveTaskSubagent(finalToolCall, undefined);
		expect(afterFullPayload).toEqual({
			subagentType: "agent-native-reviewer",
			description: "Audit new workflow",
			prompt: "Check whether tool interactions are agent-accessible",
		});
	});
});
