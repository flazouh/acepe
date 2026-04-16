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

function createTrackedManager(initialEntries?: Array<{ sessionId: string; entry: SessionEntry }>): {
	manager: ToolCallManager;
	entryStore: IEntryStoreInternal;
	entryIndex: IEntryIndex;
} {
	const entriesBySession = new Map<string, SessionEntry[]>();
	for (const item of initialEntries ?? []) {
		const existingEntries = entriesBySession.get(item.sessionId) ?? [];
		existingEntries.push(item.entry);
		entriesBySession.set(item.sessionId, existingEntries);
	}

	const entryStore = createMockEntryStore({
		getEntries: vi.fn((sessionId: string) => entriesBySession.get(sessionId) ?? []),
		addEntry: vi.fn((sessionId: string, entry: SessionEntry) => {
			const existingEntries = entriesBySession.get(sessionId) ?? [];
			existingEntries.push(entry);
			entriesBySession.set(sessionId, existingEntries);
		}),
		updateEntry: vi.fn((sessionId: string, index: number, entry: SessionEntry) => {
			const existingEntries = entriesBySession.get(sessionId) ?? [];
			existingEntries[index] = entry;
			entriesBySession.set(sessionId, existingEntries);
		}),
		hasSession: vi.fn((sessionId: string) => entriesBySession.has(sessionId)),
	});
	const entryIndex = createMockEntryIndex({
		getToolCallIdIndex: vi.fn((sessionId: string, toolCallId: string) => {
			const entries = entriesBySession.get(sessionId) ?? [];
			const index = entries.findIndex(
				(entry) => entry.type === "tool_call" && entry.message.id === toolCallId
			);
			return index >= 0 ? index : undefined;
		}),
	});

	return {
		manager: new ToolCallManager(entryStore, entryIndex),
		entryStore,
		entryIndex,
	};
}

function applyStreamingArguments(
	manager: ToolCallManager,
	sessionId: string,
	toolCallId: string,
	args: ToolArguments
): void {
	const result = manager.updateEntry(
		sessionId,
		createToolCallUpdate(toolCallId, {
			streamingArguments: args,
		})
	);
	expect(result.isOk()).toBe(true);
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

		it("preserves richer edit arguments when duplicate create data is sparse", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Edit",
					status: "pending",
					arguments: {
						kind: "edit",
						edits: [
							{
								filePath: "/tmp/example.rs",
								moveFrom: undefined,
								oldString: "before",
								newString: "after",
								content: null,
							},
						],
					},
					kind: "edit",
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

			const sparseData = createToolCallData("tc-1", {
				name: "Edit",
				status: "completed",
				kind: "edit",
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
			});
			const result = manager.createEntry("s1", sparseData);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.arguments).toEqual({
					kind: "edit",
					edits: [
						{
							filePath: "/tmp/example.rs",
							moveFrom: undefined,
							oldString: "before",
							newString: "after",
							content: null,
						},
					],
				});
			}
		});

		it("preserves richer search arguments when duplicate create data is sparse", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Search",
					status: "pending",
					arguments: {
						kind: "search",
						query: "#\\[tauri::command\\]",
						file_path: "src/",
					},
					kind: "search",
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

			const sparseData = createToolCallData("tc-1", {
				name: "Search",
				status: "completed",
				kind: "search",
				arguments: {
					kind: "search",
					query: null,
					file_path: null,
				},
			});
			const result = manager.createEntry("s1", sparseData);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.arguments).toEqual({
					kind: "search",
					query: "#\\[tauri::command\\]",
					file_path: "src/",
				});
			}
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

		it("merges replayed question answers into an existing tool call", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "AskUserQuestion",
					status: "completed",
					arguments: { kind: "other", raw: { prompt: "Ship it?" } },
					kind: "question",
					title: "Ask question",
					rawInput: null,
					result: null,
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
				status: "completed",
				rawInput: { prompt: "Ship it?" },
				questionAnswer: {
					questions: [
						{
							question: "Ship it?",
							header: "Confirmation",
							options: [],
							multiSelect: false,
						},
					],
					answers: { "Ship it?": "Yes" },
				},
			});
			const result = manager.createEntry("s1", replayedData);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.rawInput).toEqual({ prompt: "Ship it?" });
				expect(updatedEntry.message.questionAnswer).toEqual({
					questions: [
						{
							question: "Ship it?",
							header: "Confirmation",
							options: [],
							multiSelect: false,
						},
					],
					answers: { "Ship it?": "Yes" },
				});
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

		it("clears stale plan approval state when replayed create data resolves approval", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "CreatePlan",
					status: "in_progress",
					arguments: { kind: "other", raw: {} },
					awaitingPlanApproval: true,
					planApprovalRequestId: 77,
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

			const resolvedData = createToolCallData("tc-1", {
				status: "in_progress",
				awaitingPlanApproval: false,
				planApprovalRequestId: null,
			});
			const result = manager.createEntry("s1", resolvedData);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.awaitingPlanApproval).toBe(false);
				expect(updatedEntry.message.planApprovalRequestId).toBeNull();
			}
		});

		it("does NOT clear streaming arguments on create (deferred to completion)", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
			]);

			// Set streaming args first
			applyStreamingArguments(manager, "s1", "tc-1", { kind: "read", file_path: "/foo" });
			expect(manager.getStreamingArguments("tc-1")).toBeDefined();

			// Create entry does NOT clear them — streaming args stay as reactive fallback
			// until the tool completes. Clearing here would cause blank card race condition.
			manager.createEntry("s1", createToolCallData("tc-1"));
			expect(manager.getStreamingArguments("tc-1")).toBeDefined();
		});
	});

	// ============================================
	// updateEntry
	// ============================================

	describe("updateEntry", () => {
		it("does not synthesize a placeholder entry when a canonical tool row is missing", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			const update = createToolCallUpdate("tc-new", { status: "pending" });
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			expect(entryStore.addEntry).not.toHaveBeenCalled();
			expect(entryStore.updateEntry).not.toHaveBeenCalled();
		});

		it("ignores streaming-only updates when the tool call does not exist yet", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			const update = createToolCallUpdate("tc-streaming-only", {
				streamingArguments: { kind: "execute", command: "bun test" },
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			expect(entryStore.addEntry).not.toHaveBeenCalled();
			expect(entryStore.updateEntry).not.toHaveBeenCalled();
		});

		it("ignores raw streaming delta-only updates when the tool call does not exist yet", () => {
			const entryStore = createMockEntryStore();
			const entryIndex = createMockEntryIndex();
			const manager = new ToolCallManager(entryStore, entryIndex);

			const update = createToolCallUpdate("tc-streaming-delta-only", {
				streamingInputDelta: '{"command":"bun',
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			expect(entryStore.addEntry).not.toHaveBeenCalled();
			expect(entryStore.updateEntry).not.toHaveBeenCalled();
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

		it("preserves richer search arguments when a sparse completion update arrives", () => {
			const existingEntry: SessionEntry = {
				id: "tc-1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Search",
					status: "in_progress",
					arguments: {
						kind: "search",
						query: "#\\[tauri::command\\]",
						file_path: "src/",
					},
					kind: "search",
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
				arguments: {
					kind: "search",
					query: null,
					file_path: null,
				},
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.arguments).toEqual({
					kind: "search",
					query: "#\\[tauri::command\\]",
					file_path: "src/",
				});
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
			expect(entryStore.addEntry).not.toHaveBeenCalled();
			expect(entryStore.updateEntry).not.toHaveBeenCalled();
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

		it("preserves richer edit arguments when update payload is sparse", () => {
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
						edits: [
							{
								filePath: "/tmp/example.rs",
								moveFrom: undefined,
								oldString: "before",
								newString: "after",
								content: null,
							},
						],
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
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.arguments).toEqual({
					kind: "edit",
					edits: [
						{
							filePath: "/tmp/example.rs",
							moveFrom: undefined,
							oldString: "before",
							newString: "after",
							content: null,
						},
					],
				});
			}
		});

		it("preserves generic titles when backend omits canonical rename presentation", () => {
			const existingEntry: SessionEntry = {
				id: "tc-rename",
				type: "tool_call",
				message: {
					id: "tc-rename",
					name: "Edit",
					status: "in_progress",
					kind: "edit",
					title: "Edit File",
					arguments: {
						kind: "edit",
						edits: [
							{
								filePath: null,
								moveFrom: null,
								oldString: null,
								newString: null,
								content: null,
							},
						],
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

			const update = createToolCallUpdate("tc-rename", {
				status: "completed",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/tmp/new.rs",
							moveFrom: "/tmp/old.rs",
							oldString: null,
							newString: null,
							content: null,
						},
					],
				},
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.title).toBe("Edit File");
				expect(updatedEntry.message.locations).toBeUndefined();
			}
		});

		it("preserves moveFrom metadata when update payload is sparse", () => {
			const existingEntry: SessionEntry = {
				id: "tc-rename",
				type: "tool_call",
				message: {
					id: "tc-rename",
					name: "Edit",
					status: "in_progress",
					kind: "edit",
					arguments: {
						kind: "edit",
						edits: [
							{
								filePath: "/tmp/new.rs",
								moveFrom: "/tmp/old.rs",
								oldString: null,
								newString: null,
								content: null,
							},
						],
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

			const update = createToolCallUpdate("tc-rename", {
				status: "completed",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: null,
							moveFrom: null,
							oldString: null,
							newString: null,
							content: null,
						},
					],
				},
			});
			const result = manager.updateEntry("s1", update);

			expect(result.isOk()).toBe(true);
			const updatedEntry = (entryStore.updateEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][2] as SessionEntry;
			if (updatedEntry.type === "tool_call") {
				expect(updatedEntry.message.arguments).toEqual({
					kind: "edit",
					edits: [
						{
							filePath: "/tmp/new.rs",
							moveFrom: "/tmp/old.rs",
							oldString: null,
							newString: null,
							content: null,
						},
					],
				});
			}
		});
	});

	// ============================================
	// STREAMING ARGUMENTS
	// ============================================

	describe("streaming arguments", () => {
		it("updates and gets streaming arguments through canonical tool updates", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
			]);

			const args: ToolArguments = { kind: "read", file_path: "/foo/bar.ts" };
			applyStreamingArguments(manager, "s1", "tc-1", args);

			expect(manager.getStreamingArguments("tc-1")).toEqual(args);
		});

		it("stores progressive arguments on the canonical tool entry", () => {
			const existingEntry = createToolCallEntry("tc-1");
			const entries = [existingEntry];
			const entryStore = createMockEntryStore({
				getEntries: vi.fn(() => entries),
				updateEntry: vi.fn((_, index, entry) => {
					entries[index] = entry;
				}),
			});
			const entryIndex = createMockEntryIndex({
				getToolCallIdIndex: vi.fn((_, toolCallId) => (toolCallId === "tc-1" ? 0 : undefined)),
			});
			const manager = new ToolCallManager(entryStore, entryIndex);

			const args: ToolArguments = { kind: "read", file_path: "/foo/bar.ts" };
			applyStreamingArguments(manager, "s1", "tc-1", args);

			expect(entryStore.updateEntry).toHaveBeenCalledWith(
				"s1",
				0,
				expect.objectContaining({
					message: expect.objectContaining({
						progressiveArguments: args,
					}),
				})
			);
		});

		it("returns undefined for unknown tool call", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			expect(manager.getStreamingArguments("unknown")).toBeUndefined();
		});

		it("clears streaming arguments for a tool call", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
			]);

			applyStreamingArguments(manager, "s1", "tc-1", { kind: "read", file_path: "/foo" });
			manager.clearStreamingArguments("tc-1");

			expect(manager.getStreamingArguments("tc-1")).toBeUndefined();
		});

		it("overwrites existing streaming arguments", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
			]);

			applyStreamingArguments(manager, "s1", "tc-1", { kind: "read", file_path: "/first" });
			applyStreamingArguments(manager, "s1", "tc-1", { kind: "read", file_path: "/second" });

			expect(manager.getStreamingArguments("tc-1")).toEqual({ kind: "read", file_path: "/second" });
		});

		it("keeps canonical streaming arguments stable across identical updates", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
			]);

			const firstArgs: ToolArguments = { kind: "execute", command: "bun test" };
			const identicalArgs: ToolArguments = { kind: "execute", command: "bun test" };

			applyStreamingArguments(manager, "s1", "tc-1", firstArgs);
			applyStreamingArguments(manager, "s1", "tc-1", identicalArgs);

			expect(manager.getStreamingArguments("tc-1")).toEqual(firstArgs);
		});

		it("updates canonical streaming arguments when the payload changes", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
			]);

			const firstArgs: ToolArguments = { kind: "read", file_path: "/first" };
			const changedArgs: ToolArguments = { kind: "read", file_path: "/second" };

			applyStreamingArguments(manager, "s1", "tc-1", firstArgs);
			applyStreamingArguments(manager, "s1", "tc-1", changedArgs);

			expect(manager.getStreamingArguments("tc-1")).toEqual(changedArgs);
		});

		it("supports task output progressive arguments through canonical updates", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
			]);

			const firstArgs: ToolArguments = {
				kind: "taskOutput",
				task_id: "task-1",
				timeout: 30,
			};
			const identicalArgs: ToolArguments = {
				kind: "taskOutput",
				task_id: "task-1",
				timeout: 30,
			};

			applyStreamingArguments(manager, "s1", "tc-1", firstArgs);
			applyStreamingArguments(manager, "s1", "tc-1", identicalArgs);

			expect(manager.getStreamingArguments("tc-1")).toEqual(firstArgs);
		});

		it("isolates progressive arguments per tool and session", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
				{ sessionId: "s2", entry: createToolCallEntry("tc-2") },
				{ sessionId: "s1", entry: createToolCallEntry("tc-3") },
			]);

			const s1Args: ToolArguments = { kind: "read", file_path: "/same" };
			const s2Args: ToolArguments = { kind: "read", file_path: "/same" };
			const otherToolArgs: ToolArguments = { kind: "read", file_path: "/same" };

			applyStreamingArguments(manager, "s1", "tc-1", s1Args);
			applyStreamingArguments(manager, "s2", "tc-2", s2Args);
			applyStreamingArguments(manager, "s1", "tc-3", otherToolArgs);

			expect(manager.getStreamingArguments("tc-1")).toEqual(s1Args);
			expect(manager.getStreamingArguments("tc-2")).toEqual(s2Args);
			expect(manager.getStreamingArguments("tc-3")).toEqual(otherToolArgs);
		});

		it("drops streaming-only updates when session limit exceeded", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());

			// Fill up to MAX_SESSIONS (100)
			for (let i = 0; i < 100; i++) {
				applyStreamingArguments(manager, `session-${i}`, `tc-${i}`, { kind: "other", raw: {} });
			}

			// Session 101 should be dropped
			applyStreamingArguments(manager, "session-overflow", "tc-overflow", {
				kind: "other",
				raw: {},
			});
			expect(manager.getStreamingArguments("tc-overflow")).toBeUndefined();
		});

		it("allows adding to existing session even when limit is reached", () => {
			const { manager } = createTrackedManager();

			// Fill up to MAX_SESSIONS (100)
			for (let i = 0; i < 100; i++) {
				manager.createEntry(`session-${i}`, createToolCallData(`tc-${i}`));
				applyStreamingArguments(manager, `session-${i}`, `tc-${i}`, { kind: "other", raw: {} });
			}

			// Adding to an existing session should work
			manager.createEntry("session-0", createToolCallData("tc-extra"));
			applyStreamingArguments(manager, "session-0", "tc-extra", {
				kind: "read",
				file_path: "/new",
			});
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

		it("returns tool call IDs after canonical tool entries are created", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());
			manager.createEntry("s1", createToolCallData("tc-1"));
			manager.createEntry("s1", createToolCallData("tc-2"));

			const ids = manager.getToolCallIdsForSession("s1");
			expect(ids.size).toBe(2);
			expect(ids.has("tc-1")).toBe(true);
			expect(ids.has("tc-2")).toBe(true);
		});

		it("isolates tool call IDs per session", () => {
			const manager = new ToolCallManager(createMockEntryStore(), createMockEntryIndex());
			manager.createEntry("s1", createToolCallData("tc-1"));
			manager.createEntry("s2", createToolCallData("tc-2"));

			expect(manager.getToolCallIdsForSession("s1").has("tc-1")).toBe(true);
			expect(manager.getToolCallIdsForSession("s1").has("tc-2")).toBe(false);
		});
	});

	// ============================================
	// clearSession
	// ============================================

	describe("clearSession", () => {
		it("clears all state for a session", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
				{ sessionId: "s1", entry: createToolCallEntry("tc-2") },
			]);

			// Set up state
			applyStreamingArguments(manager, "s1", "tc-1", { kind: "read", file_path: "/foo" });
			applyStreamingArguments(manager, "s1", "tc-2", { kind: "other", raw: {} });

			// Clear
			manager.clearSession("s1");

			expect(manager.getStreamingArguments("tc-1")).toBeUndefined();
			expect(manager.getStreamingArguments("tc-2")).toBeUndefined();
			expect(manager.getToolCallIdsForSession("s1").size).toBe(0);
		});

		it("does not affect other sessions", () => {
			const { manager } = createTrackedManager([
				{ sessionId: "s1", entry: createToolCallEntry("tc-1") },
				{ sessionId: "s2", entry: createToolCallEntry("tc-2") },
			]);

			applyStreamingArguments(manager, "s1", "tc-1", { kind: "other", raw: {} });
			applyStreamingArguments(manager, "s2", "tc-2", { kind: "read", file_path: "/bar" });

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

			// Clear session
			manager.clearSession("s1");

			expect(manager.getStreamingArguments("parent-1")).toBeUndefined();
		});
	});
});
