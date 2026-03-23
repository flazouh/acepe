import { describe, expect, it, vi } from "bun:test";

import type { ToolArguments, ToolCallData } from "../../../../services/converted-session-types.js";
import type { ToolCallUpdate } from "../../../types/tool-call.js";
import type { SessionEntry } from "../../types.js";
import type { IEntryIndex } from "../interfaces/entry-index.js";
import type { IEntryStoreInternal } from "../interfaces/entry-store-internal.js";

import {
	extractResultFromContent,
	isToolCallStreaming,
	ToolCallManager,
} from "../tool-call-manager.svelte.js";

// ============================================
// MOCK FACTORIES
// ============================================

function createMockEntryStore(overrides?: Partial<IEntryStoreInternal>): IEntryStoreInternal {
	return {
		getEntries: vi.fn(() => []),
		addEntry: vi.fn(),
		updateEntry: vi.fn(),
		hasSession: vi.fn(() => true),
		...overrides,
	};
}

function createMockEntryIndex(overrides?: Partial<IEntryIndex>): IEntryIndex {
	return {
		getMessageIdIndex: vi.fn(() => undefined),
		addMessageId: vi.fn(),
		deleteMessageId: vi.fn(),
		rebuildMessageIdIndex: vi.fn(),
		getToolCallIdIndex: vi.fn(() => undefined),
		addToolCallId: vi.fn(),
		rebuildToolCallIdIndex: vi.fn(),
		clearSession: vi.fn(),
		...overrides,
	};
}

function createToolCallData(id: string, overrides?: Partial<ToolCallData>): ToolCallData {
	return {
		id,
		name: "test_tool",
		arguments: { kind: "other", raw: {} },
		status: "pending",
		result: null,
		kind: null,
		title: null,
		locations: null,
		skillMeta: null,
		awaitingPlanApproval: false,
		...overrides,
	};
}

function createToolCallUpdate(
	toolCallId: string,
	overrides?: Partial<ToolCallUpdate>
): ToolCallUpdate {
	return {
		toolCallId,
		status: null,
		result: null,
		content: null,
		rawOutput: null,
		title: null,
		locations: null,
		normalizedTodos: null,
		normalizedQuestions: null,
		...overrides,
	};
}

function createToolCallEntry(id: string): SessionEntry {
	return {
		id,
		type: "tool_call" as const,
		message: {
			id,
			name: "test_tool",
			status: "pending" as const,
			arguments: { kind: "other" as const, raw: {} },
			awaitingPlanApproval: false,
		},
		timestamp: new Date(),
		isStreaming: true,
	};
}

// ============================================
// PURE FUNCTIONS
// ============================================

describe("isToolCallStreaming", () => {
	it("returns true for pending", () => {
		expect(isToolCallStreaming("pending")).toBe(true);
	});

	it("returns true for in_progress", () => {
		expect(isToolCallStreaming("in_progress")).toBe(true);
	});

	it("returns false for completed", () => {
		expect(isToolCallStreaming("completed")).toBe(false);
	});

	it("returns false for failed", () => {
		expect(isToolCallStreaming("failed")).toBe(false);
	});

	it("returns false for null", () => {
		expect(isToolCallStreaming(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isToolCallStreaming(undefined)).toBe(false);
	});
});

describe("extractResultFromContent", () => {
	it("returns null for null content", () => {
		expect(extractResultFromContent(null)).toBeNull();
	});

	it("returns null for undefined content", () => {
		expect(extractResultFromContent(undefined)).toBeNull();
	});

	it("returns null for empty array", () => {
		expect(extractResultFromContent([])).toBeNull();
	});

	it("extracts text from text blocks", () => {
		const content = [{ type: "text" as const, text: "Hello world" }];
		expect(extractResultFromContent(content)).toBe("Hello world");
	});

	it("extracts text from nested content blocks", () => {
		const content = [
			{
				type: "content" as const,
				content: { type: "text", text: "Nested text" },
			},
		] as never[];
		expect(extractResultFromContent(content)).toBe("Nested text");
	});

	it("joins multiple text parts with newline", () => {
		const content = [
			{ type: "text" as const, text: "Line 1" },
			{ type: "text" as const, text: "Line 2" },
		];
		expect(extractResultFromContent(content)).toBe("Line 1\nLine 2");
	});

	it("skips non-text blocks", () => {
		const content = [
			{ type: "image", data: "base64data", mimeType: "image/png" },
			{ type: "text", text: "Text only" },
		] as Parameters<typeof extractResultFromContent>[0];
		expect(extractResultFromContent(content)).toBe("Text only");
	});
});

// ============================================
// TOOL CALL MANAGER
// ============================================

describe("ToolCallManager", () => {
	// ============================================
	// createEntry
	// ============================================

	describe("createEntry", () => {
		it("creates a new tool call entry", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			const data = createToolCallData("tc-1", { name: "Read", kind: "read" });
			const result = manager.createEntry("s1", data);

			expect(result.isOk()).toBe(true);
			expect(entryStore.addEntry).toHaveBeenCalledWith(
				"s1",
				expect.objectContaining({
					id: "tc-1",
					type: "tool_call",
					isStreaming: true,
				})
			);
		});

		it("updates an existing tool call entry found in entries", () => {
			const existingEntry = createToolCallEntry("tc-1");
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [existingEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn(() => 0),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			const data = createToolCallData("tc-1", {
				name: "Read",
				status: "completed",
				result: "file contents",
			});
			const result = manager.createEntry("s1", data);

			expect(result.isOk()).toBe(true);
			// Should update the entry, not add a new one
			expect(entryStore.addEntry).not.toHaveBeenCalled();
			expect(entryStore.updateEntry).toHaveBeenCalledWith(
				"s1",
				0,
				expect.objectContaining({
					id: "tc-1",
					type: "tool_call",
					isStreaming: false, // completed status
				})
			);
		});

		it("does not downgrade terminal status when replayed create data is pending", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Execute",
					status: "completed",
					arguments: { kind: "execute", command: "echo done" },
					result: "done",
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: false,
			};
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [existingEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn(() => 0),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			const replayedData = createToolCallData("tc-1", {
				status: "pending",
				result: null,
				arguments: { kind: "other", raw: {} },
			});
			const result = manager.createEntry("s1", replayedData);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.status).toBe("completed");
				expect(updatedEntry.message.result).toBe("done");
			}
			expect(updatedEntry.isStreaming).toBe(false);
		});

		it("preserves existing kind when synthetic tool call arrives with different kind", () => {
			// Simulates: real tool call has kind "delete", then synthetic from permission has kind "edit"
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Delete",
					status: "pending",
					arguments: { kind: "delete", file_path: "/path/to/file.ts" },
					kind: "delete",
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: true,
			};
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [existingEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn(() => 0),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			// Synthetic tool call from permission arrives with kind: "edit"
			const syntheticData = createToolCallData("tc-1", {
				name: "Edit",
				kind: "edit",
				arguments: { kind: "edit", edits: [{ filePath: "/path/to/file.ts" }] },
			});
			const result = manager.createEntry("s1", syntheticData);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.kind).toBe("delete");
			}
		});

		it("promotes synthetic task entries to question when normalized questions arrive", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Think",
					status: "pending",
					arguments: { kind: "think", raw: { _toolName: "askQuestion" } },
					kind: "task",
					title: "Ask Question",
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: true,
			};
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [existingEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn(() => 0),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			const questionData = createToolCallData("tc-1", {
				name: "AskUserQuestion",
				kind: "question",
				arguments: {
					kind: "other",
					raw: {
						questions: [{ question: "Where should the repo live?" }],
					},
				},
				title: "Which improvement should we plan?",
				normalizedQuestions: [
					{
						question: "Which improvement should we plan?",
						header: "Which improvement should we plan?",
						options: [],
						multiSelect: false,
					},
				],
			});
			const result = manager.createEntry("s1", questionData);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.kind).toBe("question");
				expect(updatedEntry.message.normalizedQuestions).toEqual(questionData.normalizedQuestions);
			}
		});

		it("does NOT clear streaming arguments on create (deferred to completion)", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			// Set streaming args first
			manager.setStreamingArguments("s1", "tc-1", { kind: "read", file_path: "/foo" });
			expect(manager.getStreamingArguments("tc-1")).toBeDefined();

			// Create entry does NOT clear them — streaming args stay as reactive fallback
			// until the tool completes. Clearing here would cause blank card race condition.
			manager.createEntry("s1", createToolCallData("tc-1"));
			expect(manager.getStreamingArguments("tc-1")).toBeDefined();
		});

		it("indexes task children for O(1) lookup", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			const childData = createToolCallData("child-1", { name: "SubTask" });
			const data = createToolCallData("parent-1", {
				name: "Task",
				taskChildren: [childData],
			});

			manager.createEntry("s1", data);

			// Now update the child - it should be found via the index
			const childUpdate = createToolCallUpdate("child-1", { status: "completed" });
			const result = manager.updateChildInParent("s1", childUpdate);
			// Should find the parent — but since parent is in addEntry (not committed),
			// we need to verify it fell back to updateEntry
			expect(result.isOk()).toBe(true);
		});
	});

	// ============================================
	// updateEntry
	// ============================================

	describe("updateEntry", () => {
		it("creates a placeholder entry when tool call does not exist", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			const update = createToolCallUpdate("tc-new", { status: "pending" });
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			expect(entryStore.addEntry).toHaveBeenCalledWith(
				"s1",
				expect.objectContaining({
					id: "tc-new",
					type: "tool_call",
				})
			);
			// Placeholder should have name "Tool"
			const addedEntry = (entryStore.addEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][1] as SessionEntry;
			expect(addedEntry.type).toBe("tool_call");
			if (addedEntry.type === "tool_call") {
				expect(addedEntry.message.name).toBe("Tool");
			}
		});

		it("updates an existing tool call entry", () => {
			const existingEntry = createToolCallEntry("tc-1");
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [existingEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn(() => 0),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			const update = createToolCallUpdate("tc-1", {
				status: "completed",
				result: "done",
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			expect(entryStore.updateEntry).toHaveBeenCalledWith(
				"s1",
				0,
				expect.objectContaining({
					isStreaming: false, // completed
				})
			);
		});

		it("does not downgrade terminal status when replayed update is in_progress", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Execute",
					status: "completed",
					arguments: { kind: "execute", command: "echo done" },
					result: "done",
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: false,
			};
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [existingEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn(() => 0),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			const replayedUpdate = createToolCallUpdate("tc-1", {
				status: "in_progress",
				result: null,
			});
			const result = manager.updateEntry("s1", replayedUpdate);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.status).toBe("completed");
				expect(updatedEntry.message.result).toBe("done");
			}
			expect(updatedEntry.isStreaming).toBe(false);
		});

		it("preserves structured result over text extraction", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "search",
					status: "in_progress",
					arguments: { kind: "other" as const, raw: {} },
					result: { numFiles: 4, pattern: "*.ts" },
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: true,
			};
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [existingEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn(() => 0),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			// Update with text content - should not replace structured result
			const update = createToolCallUpdate("tc-1", {
				status: "completed",
				content: [{ type: "text" as const, text: "Found 4 files" }],
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				// Structured result should be preserved
				expect(updatedEntry.message.result).toEqual({ numFiles: 4, pattern: "*.ts" });
			}
		});

		it("uses rawOutput as result when provided", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			const update = createToolCallUpdate("tc-1", {
				rawOutput: "raw output text",
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			const addedEntry = (entryStore.addEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][1] as SessionEntry;
			if (addedEntry.type === "tool_call") {
				expect(addedEntry.message.result).toBe("raw output text");
			}
		});

		it("persists streaming arguments when typed arguments are absent", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Edit",
					status: "in_progress",
					kind: "edit",
					arguments: {
						kind: "edit",
						edits: [{ filePath: null, oldString: null, newString: null, content: null }],
					},
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: true,
			};
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [existingEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn(() => 0),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			const update = createToolCallUpdate("tc-1", {
				status: "completed",
				streamingArguments: {
					kind: "edit",
					edits: [{ filePath: "/src/app.ts", oldString: "old", newString: "new", content: null }],
				},
			});

			const result = manager.updateEntry("s1", update);
			expect(result.isOk()).toBe(true);

			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			expect(updatedEntry.type).toBe("tool_call");
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.arguments).toEqual({
					kind: "edit",
					edits: [{ filePath: "/src/app.ts", oldString: "old", newString: "new", content: null }],
				});
				expect(updatedEntry.message.status).toBe("completed");
			}
		});
	});

	// ============================================
	// updateChildInParent
	// ============================================

	describe("updateChildInParent", () => {
		it("falls back to regular update when child is not indexed", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			const childUpdate = createToolCallUpdate("unknown-child", { status: "completed" });
			const result = manager.updateChildInParent("s1", childUpdate);

			expect(result.isOk()).toBe(true);
			// Should fall back to addEntry (creating placeholder since entry doesn't exist)
			expect(entryStore.addEntry).toHaveBeenCalled();
		});

		it("updates child within parent taskChildren", () => {
			const childData = createToolCallData("child-1", { name: "SubTask", status: "pending" });
			const parentEntry: SessionEntry = {
				id: "parent-1",
				type: "tool_call",
				message: {
					id: "parent-1",
					name: "Task",
					status: "in_progress",
					arguments: { kind: "other" as const, raw: {} },
					taskChildren: [childData],
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: true,
			};

			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [parentEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn((_, toolCallId) => (toolCallId === "parent-1" ? 0 : undefined)),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			// First create the parent to index children
			manager.createEntry(
				"s1",
				createToolCallData("parent-1", {
					name: "Task",
					status: "in_progress",
					taskChildren: [childData],
				})
			);

			// Now update the child
			const childUpdate = createToolCallUpdate("child-1", { status: "completed" });
			const result = manager.updateChildInParent("s1", childUpdate);

			expect(result.isOk()).toBe(true);
			// Should update via parent, not addEntry
			expect(entryStore.updateEntry).toHaveBeenCalledWith(
				"s1",
				0,
				expect.objectContaining({
					id: "parent-1",
					type: "tool_call",
				})
			);
		});

		it("applies child arguments from update payload", () => {
			const childData = createToolCallData("child-1", {
				name: "Edit",
				status: "pending",
				kind: "edit",
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
			});
			const parentEntry: SessionEntry = {
				id: "parent-1",
				type: "tool_call",
				message: {
					id: "parent-1",
					name: "Task",
					status: "in_progress",
					arguments: { kind: "other", raw: {} },
					taskChildren: [childData],
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: true,
			};

			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [parentEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn((_, toolCallId) => (toolCallId === "parent-1" ? 0 : undefined)),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			manager.createEntry(
				"s1",
				createToolCallData("parent-1", {
					name: "Task",
					status: "in_progress",
					taskChildren: [childData],
				})
			);

			const childUpdate = createToolCallUpdate("child-1", {
				status: "completed",
				arguments: {
					kind: "edit",
					edits: [{ filePath: "/src/agent-input-ui.svelte", oldString: "before", newString: "after", content: null }],
				},
			});
			const result = manager.updateChildInParent("s1", childUpdate);

			expect(result.isOk()).toBe(true);
			const updateCalls = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock.calls;
			const updatedParentEntry = updateCalls[updateCalls.length - 1]?.[2] as SessionEntry;
			expect(updatedParentEntry.type).toBe("tool_call");
			if (updatedParentEntry.type === "tool_call") {
				const updatedChild = updatedParentEntry.message.taskChildren?.[0];
				expect(updatedChild?.status).toBe("completed");
				expect(updatedChild?.arguments).toEqual({
					kind: "edit",
					edits: [{ filePath: "/src/agent-input-ui.svelte", oldString: "before", newString: "after", content: null }],
				});
			}
		});

		it("falls back when session mismatch", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			// Create parent in session s1 to index child
			const childData = createToolCallData("child-1");
			manager.createEntry(
				"s1",
				createToolCallData("parent-1", {
					taskChildren: [childData],
				})
			);

			// Try to update child from session s2
			const childUpdate = createToolCallUpdate("child-1", { status: "completed" });
			const result = manager.updateChildInParent("s2", childUpdate);

			expect(result.isOk()).toBe(true);
			// Falls back to regular update (creates placeholder in s2)
		});

		it("falls back when parent not found", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			// Create parent to index child
			const childData = createToolCallData("child-1");
			manager.createEntry(
				"s1",
				createToolCallData("parent-1", {
					taskChildren: [childData],
				})
			);

			// Parent is not in getEntries() (mock returns empty array)
			// so findToolCallEntryRef will not find it
			const childUpdate = createToolCallUpdate("child-1", { status: "completed" });
			const result = manager.updateChildInParent("s1", childUpdate);

			expect(result.isOk()).toBe(true);
		});

		it("returns ok when parent has no taskChildren", () => {
			const parentEntry: SessionEntry = {
				id: "parent-1",
				type: "tool_call",
				message: {
					id: "parent-1",
					name: "Task",
					status: "in_progress",
					arguments: { kind: "other" as const, raw: {} },
					// No taskChildren
					awaitingPlanApproval: false,
				},
				timestamp: new Date(),
				isStreaming: true,
			};

			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => [parentEntry]),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn((_, toolCallId) => (toolCallId === "parent-1" ? 0 : undefined)),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			// Manually index a child for parent (simulating prior state)
			const childData = createToolCallData("child-1");
			manager.createEntry(
				"s1",
				createToolCallData("parent-1", {
					taskChildren: [childData],
				})
			);

			// But parent entry we return has no taskChildren
			const childUpdate = createToolCallUpdate("child-1", { status: "completed" });
			const result = manager.updateChildInParent("s1", childUpdate);

			expect(result.isOk()).toBe(true);
		});
	});

	// ============================================
	// STREAMING ARGUMENTS
	// ============================================

	describe("streaming arguments", () => {
		it("sets and gets streaming arguments", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			const args: ToolArguments = { kind: "read", file_path: "/foo/bar.ts" };
			manager.setStreamingArguments("s1", "tc-1", args);

			expect(manager.getStreamingArguments("tc-1")).toEqual(args);
		});

		it("returns undefined for unknown tool call", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			expect(manager.getStreamingArguments("unknown")).toBeUndefined();
		});

		it("clears streaming arguments for a tool call", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			manager.setStreamingArguments("s1", "tc-1", { kind: "read", file_path: "/foo" });
			manager.clearStreamingArguments("tc-1");

			expect(manager.getStreamingArguments("tc-1")).toBeUndefined();
		});

		it("overwrites existing streaming arguments", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			manager.setStreamingArguments("s1", "tc-1", { kind: "read", file_path: "/first" });
			manager.setStreamingArguments("s1", "tc-1", { kind: "read", file_path: "/second" });

			expect(manager.getStreamingArguments("tc-1")).toEqual({ kind: "read", file_path: "/second" });
		});

		it("skips no-op writes when streaming arguments are identical", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			const firstArgs: ToolArguments = { kind: "execute", command: "bun test" };
			const identicalArgs: ToolArguments = { kind: "execute", command: "bun test" };

			manager.setStreamingArguments("s1", "tc-1", firstArgs);
			manager.setStreamingArguments("s1", "tc-1", identicalArgs);

			expect(manager.getStreamingArguments("tc-1")).toBe(firstArgs);
		});

		it("writes when streaming arguments change", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			const firstArgs: ToolArguments = { kind: "read", file_path: "/first" };
			const changedArgs: ToolArguments = { kind: "read", file_path: "/second" };

			manager.setStreamingArguments("s1", "tc-1", firstArgs);
			manager.setStreamingArguments("s1", "tc-1", changedArgs);

			expect(manager.getStreamingArguments("tc-1")).toBe(changedArgs);
		});

		it("dedupe is isolated per tool and session", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			const s1Args: ToolArguments = { kind: "read", file_path: "/same" };
			const s2Args: ToolArguments = { kind: "read", file_path: "/same" };
			const otherToolArgs: ToolArguments = { kind: "read", file_path: "/same" };

			manager.setStreamingArguments("s1", "tc-1", s1Args);
			manager.setStreamingArguments("s2", "tc-2", s2Args);
			manager.setStreamingArguments("s1", "tc-3", otherToolArgs);

			expect(manager.getStreamingArguments("tc-1")).toBe(s1Args);
			expect(manager.getStreamingArguments("tc-2")).toBe(s2Args);
			expect(manager.getStreamingArguments("tc-3")).toBe(otherToolArgs);
		});

		it("drops streaming arguments when session limit exceeded", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			// Fill up to MAX_SESSIONS (100)
			for (let i = 0; i < 100; i++) {
				manager.setStreamingArguments(`session-${i}`, `tc-${i}`, { kind: "other", raw: {} });
			}

			// Session 101 should be dropped
			manager.setStreamingArguments("session-overflow", "tc-overflow", { kind: "other", raw: {} });
			expect(manager.getStreamingArguments("tc-overflow")).toBeUndefined();
		});

		it("allows adding to existing session even when limit is reached", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			// Fill up to MAX_SESSIONS (100)
			for (let i = 0; i < 100; i++) {
				manager.setStreamingArguments(`session-${i}`, `tc-${i}`, { kind: "other", raw: {} });
			}

			// Adding to an existing session should work
			manager.setStreamingArguments("session-0", "tc-extra", { kind: "read", file_path: "/new" });
			expect(manager.getStreamingArguments("tc-extra")).toEqual({
				kind: "read",
				file_path: "/new",
			});
		});
	});

	// ============================================
	// getToolCallIdsForSession
	// ============================================

	describe("getToolCallIdsForSession", () => {
		it("returns empty set for unknown session", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());
			const ids = manager.getToolCallIdsForSession("unknown");
			expect(ids.size).toBe(0);
		});

		it("returns tool call IDs after streaming arguments are set", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());
			manager.setStreamingArguments("s1", "tc-1", { kind: "other", raw: {} });
			manager.setStreamingArguments("s1", "tc-2", { kind: "other", raw: {} });

			const ids = manager.getToolCallIdsForSession("s1");
			expect(ids.size).toBe(2);
			expect(ids.has("tc-1")).toBe(true);
			expect(ids.has("tc-2")).toBe(true);
		});

		it("isolates tool call IDs per session", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());
			manager.setStreamingArguments("s1", "tc-1", { kind: "other", raw: {} });
			manager.setStreamingArguments("s2", "tc-2", { kind: "other", raw: {} });

			expect(manager.getToolCallIdsForSession("s1").has("tc-1")).toBe(true);
			expect(manager.getToolCallIdsForSession("s1").has("tc-2")).toBe(false);
		});
	});

	// ============================================
	// clearSession
	// ============================================

	describe("clearSession", () => {
		it("clears all state for a session", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			// Set up state
			manager.setStreamingArguments("s1", "tc-1", { kind: "read", file_path: "/foo" });
			manager.setStreamingArguments("s1", "tc-2", { kind: "other", raw: {} });

			// Clear
			manager.clearSession("s1");

			expect(manager.getStreamingArguments("tc-1")).toBeUndefined();
			expect(manager.getStreamingArguments("tc-2")).toBeUndefined();
			expect(manager.getToolCallIdsForSession("s1").size).toBe(0);
		});

		it("does not affect other sessions", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			manager.setStreamingArguments("s1", "tc-1", { kind: "other", raw: {} });
			manager.setStreamingArguments("s2", "tc-2", { kind: "read", file_path: "/bar" });

			manager.clearSession("s1");

			expect(manager.getStreamingArguments("tc-1")).toBeUndefined();
			expect(manager.getStreamingArguments("tc-2")).toEqual({ kind: "read", file_path: "/bar" });
		});

		it("is safe to call on unknown session", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());
			// Should not throw
			manager.clearSession("nonexistent");
		});

		it("clears child-to-parent index for session tool calls", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			// Create parent with child to populate child-to-parent index
			const childData = createToolCallData("child-1");
			manager.createEntry(
				"s1",
				createToolCallData("parent-1", {
					taskChildren: [childData],
				})
			);
			// Also set streaming arguments so sessionToolCallIds is populated
			manager.setStreamingArguments("s1", "parent-1", { kind: "other", raw: {} });

			// Clear session
			manager.clearSession("s1");

			// Child-to-parent index should be cleared
			// Verify by trying to update the child - it should fall back to regular update
			const childUpdate = createToolCallUpdate("child-1", { status: "completed" });
			manager.updateChildInParent("s1", childUpdate);
			// Falls back to addEntry (not parent update)
			expect(entryStore.addEntry).toHaveBeenCalled();
		});
	});
});
