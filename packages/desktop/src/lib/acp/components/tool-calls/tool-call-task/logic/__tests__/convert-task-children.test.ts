import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel, AgentToolEntry } from "@acepe/ui/agent-panel";
import type { ToolCall } from "$lib/acp/types/tool-call.js";

import { convertTaskChildren } from "../convert-task-children.js";

function asToolCall(entry: AgentPanelSceneEntryModel | undefined): AgentToolEntry {
	if (!entry || entry.type !== "tool_call") throw new Error("Expected tool_call entry");
	return entry;
}

function createChild(
	overrides: Partial<ToolCall> & Pick<ToolCall, "id" | "kind" | "status">
): ToolCall {
	return {
		name: overrides.name !== undefined ? overrides.name : "ToolName",
		arguments:
			overrides.arguments !== undefined ? overrides.arguments : { kind: "other", raw: null },
		title: null,
		locations: null,
		skillMeta: null,
		result: null,
		awaitingPlanApproval:
			overrides.awaitingPlanApproval !== undefined ? overrides.awaitingPlanApproval : false,
		...overrides,
	};
}

describe("convertTaskChildren", () => {
	it("returns empty array for null input", () => {
		expect(convertTaskChildren(null)).toEqual([]);
	});

	it("returns empty array for undefined input", () => {
		expect(convertTaskChildren(undefined)).toEqual([]);
	});

	it("returns empty array for empty array input", () => {
		expect(convertTaskChildren([])).toEqual([]);
	});

	describe("status mapping", () => {
		it("maps 'pending' to 'done' when turn state is not streaming", () => {
			const children = [createChild({ id: "t1", kind: "read", status: "pending" })];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).status).toBe("done");
		});

		it("maps 'in_progress' to 'running'", () => {
			const children = [createChild({ id: "t1", kind: "read", status: "in_progress" })];
			const result = convertTaskChildren(children, "streaming");
			expect(asToolCall(result[0]).status).toBe("running");
		});

		it("maps 'in_progress' to 'done' when turn is not streaming", () => {
			const children = [createChild({ id: "t1", kind: "read", status: "in_progress" })];
			const result = convertTaskChildren(children, "completed");
			expect(asToolCall(result[0]).status).toBe("done");
		});

		it("maps non-terminal status to 'done' when result is present", () => {
			const children = [
				createChild({
					id: "t1",
					kind: "read",
					status: "in_progress",
					result: "Finished output",
				}),
			];
			const result = convertTaskChildren(children, "streaming");
			expect(asToolCall(result[0]).status).toBe("done");
		});

		it("maps unfinished child to 'done' when the parent task completed successfully", () => {
			const children = [createChild({ id: "t1", kind: "read", status: "in_progress" })];
			const result = convertTaskChildren(children, "completed", true);
			expect(asToolCall(result[0]).status).toBe("done");
		});

		it("maps 'completed' to 'done'", () => {
			const children = [createChild({ id: "t1", kind: "read", status: "completed" })];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).status).toBe("done");
		});

		it("maps 'failed' to 'error'", () => {
			const children = [createChild({ id: "t1", kind: "read", status: "failed" })];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).status).toBe("error");
		});
	});

	describe("kind mapping", () => {
		it.each([
			["read", "read"],
			["edit", "edit"],
			["delete", "delete"],
			["execute", "execute"],
			["search", "search"],
			["fetch", "fetch"],
			["web_search", "web_search"],
			["think", "think"],
			["task", "task"],
			["task_output", "task_output"],
			["skill", "skill"],
			["browser", "browser"],
		] as const)("maps '%s' to '%s'", (input, expected) => {
			const children = [createChild({ id: "t1", kind: input, status: "completed" })];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).kind).toBe(expected);
		});

		it.each([
			"todo",
			"question",
			"move",
			"enter_plan_mode",
			"exit_plan_mode",
			"other",
		] as const)("maps '%s' to 'other'", (input) => {
			const children = [createChild({ id: "t1", kind: input, status: "completed" })];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).kind).toBe("other");
		});
	});

	describe("field mapping", () => {
		it("uses id from child", () => {
			const children = [createChild({ id: "child-abc", kind: "read", status: "completed" })];
			const result = convertTaskChildren(children);
			expect(result[0].id).toBe("child-abc");
		});

		it("sets type to 'tool_call'", () => {
			const children = [createChild({ id: "t1", kind: "read", status: "completed" })];
			const result = convertTaskChildren(children);
			expect(result[0].type).toBe("tool_call");
		});

		it("uses title from child when present", () => {
			const children = [
				createChild({
					id: "t1",
					kind: "read",
					status: "completed",
					title: "Read config file",
				}),
			];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).title).toBe("Read config file");
		});

		it("falls back to generated title when child title is null", () => {
			const children = [createChild({ id: "t1", kind: "read", status: "completed", title: null })];
			const result = convertTaskChildren(children);
			// Should get a non-empty title from the scene mapper
			expect(asToolCall(result[0]).title).toBeTruthy();
			expect(typeof asToolCall(result[0]).title).toBe("string");
		});

		it("extracts filePath for read tool calls", () => {
			const children = [
				createChild({
					id: "t1",
					kind: "read",
					status: "completed",
					arguments: { kind: "read", file_path: "/src/lib/utils.ts" },
				}),
			];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).filePath).toBe("/src/lib/utils.ts");
		});

		it("extracts filePath for edit tool calls", () => {
			const children = [
				createChild({
					id: "t1",
					kind: "edit",
					status: "completed",
					arguments: {
						kind: "edit",
						edits: [{ filePath: "/src/main.rs", oldString: "old", newString: "new" }],
					},
				}),
			];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).filePath).toBe("/src/main.rs");
		});

		it("extracts subtitle for search tool calls", () => {
			const children = [
				createChild({
					id: "t1",
					kind: "search",
					status: "completed",
					arguments: { kind: "search", query: "taskChildren" },
				}),
			];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).subtitle).toBe("taskChildren");
		});

		it("extracts subtitle for execute tool calls", () => {
			const children = [
				createChild({
					id: "t1",
					kind: "execute",
					status: "completed",
					arguments: { kind: "execute", command: "bun test" },
				}),
			];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).subtitle).toBe("bun test");
		});
	});

	describe("multiple children", () => {
		it("converts all children preserving order", () => {
			const children = [
				createChild({
					id: "c1",
					kind: "read",
					status: "completed",
					title: "Read file",
					arguments: { kind: "read", file_path: "/a.ts" },
				}),
				createChild({
					id: "c2",
					kind: "execute",
					status: "in_progress",
					title: "Run tests",
					arguments: { kind: "execute", command: "bun test" },
				}),
				createChild({
					id: "c3",
					kind: "edit",
					status: "pending",
					title: "Edit file",
					arguments: {
						kind: "edit",
						edits: [{ filePath: "/b.ts", oldString: "x", newString: "y" }],
					},
				}),
			];

			const result = convertTaskChildren(children, "streaming");

			expect(result).toHaveLength(3);
			expect(result[0].id).toBe("c1");
			expect(asToolCall(result[0]).status).toBe("done");
			expect(result[1].id).toBe("c2");
			expect(asToolCall(result[1]).status).toBe("running");
			expect(result[2].id).toBe("c3");
			expect(asToolCall(result[2]).status).toBe("pending");
		});
	});

	describe("edge cases", () => {
		it("handles child with no kind (defaults to 'other')", () => {
			const children = [
				createChild({
					id: "t1",
					kind: undefined as unknown as "other",
					status: "completed",
					name: "CustomTool",
				}),
			];
			const result = convertTaskChildren(children);
			expect(asToolCall(result[0]).kind).toBe("other");
		});

		it("falls back to tool name when title is null and registry returns empty", () => {
			const children = [
				createChild({
					id: "t1",
					kind: "other",
					status: "completed",
					title: null,
					name: "mcp__server__DoSomething",
				}),
			];
			const result = convertTaskChildren(children);
			// Should have some title (either from scene mapper or name fallback)
			expect(asToolCall(result[0]).title).toBeTruthy();
		});
	});
});
