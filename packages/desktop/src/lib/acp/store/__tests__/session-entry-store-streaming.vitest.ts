import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger to avoid console noise
vi.mock("../../utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		isLevelEnabled: vi.fn().mockReturnValue(false),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import { SessionEntryStore } from "../session-entry-store.svelte.js";
import type { TranscriptDelta, TranscriptSnapshot } from "../../../services/acp-types.js";
import { OperationStore } from "../operation-store.svelte.js";

function applyStreamingArguments(
	store: SessionEntryStore,
	sessionId: string,
	toolCallId: string,
	streamingArguments: Parameters<SessionEntryStore["updateToolCallEntry"]>[1]["streamingArguments"]
): void {
	store.updateToolCallEntry(sessionId, {
		toolCallId,
		status: null,
		result: null,
		content: null,
		rawOutput: null,
		title: null,
		locations: null,
		normalizedTodos: null,
		normalizedQuestions: null,
		streamingArguments,
	});
}

describe("SessionEntryStore - Streaming Arguments", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
	});

	describe("updateToolCallEntry / getStreamingArguments", () => {
		it("should store and retrieve streaming arguments from canonical updates", () => {
			store.createToolCallEntry("session1", {
				id: "tool1",
				name: "Edit",
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
				status: "pending",
				kind: "edit",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			applyStreamingArguments(store, "session1", "tool1", {
				kind: "edit",
				edits: [
					{ filePath: "/path/to/file.ts", oldString: null, newString: "content", content: null },
				],
			});

			const result = store.getStreamingArguments("tool1");
			expect(result).toEqual({
				kind: "edit",
				edits: [
					{ filePath: "/path/to/file.ts", oldString: null, newString: "content", content: null },
				],
			});
		});

		it("should track tool calls per session", () => {
			store.createToolCallEntry("session1", {
				id: "tool1",
				name: "Bash",
				arguments: { kind: "execute", command: null },
				status: "pending",
				kind: "execute",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			store.createToolCallEntry("session1", {
				id: "tool2",
				name: "Search",
				arguments: { kind: "search", query: null, file_path: null },
				status: "pending",
				kind: "search",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			store.createToolCallEntry("session2", {
				id: "tool3",
				name: "Read",
				arguments: { kind: "read", file_path: null },
				status: "pending",
				kind: "read",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			applyStreamingArguments(store, "session1", "tool1", { kind: "execute", command: "ls -la" });
			applyStreamingArguments(store, "session1", "tool2", { kind: "search", query: "test" });
			applyStreamingArguments(store, "session2", "tool3", {
				kind: "read",
				file_path: "/tmp/file",
			});

			expect(store.getStreamingArguments("tool1")).toEqual({ kind: "execute", command: "ls -la" });
			expect(store.getStreamingArguments("tool2")).toEqual({ kind: "search", query: "test" });
			expect(store.getStreamingArguments("tool3")).toEqual({
				kind: "read",
				file_path: "/tmp/file",
			});
		});

		it("should overwrite when setting same tool call again", () => {
			store.createToolCallEntry("session1", {
				id: "tool1",
				name: "Edit",
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
				status: "pending",
				kind: "edit",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			applyStreamingArguments(store, "session1", "tool1", {
				kind: "edit",
				edits: [{ filePath: "/a", oldString: null, newString: "v1", content: null }],
			});
			applyStreamingArguments(store, "session1", "tool1", {
				kind: "edit",
				edits: [{ filePath: "/a", oldString: null, newString: "v2", content: null }],
			});

			expect(store.getStreamingArguments("tool1")).toEqual({
				kind: "edit",
				edits: [{ filePath: "/a", oldString: null, newString: "v2", content: null }],
			});
		});
	});

	describe("getStreamingArguments", () => {
		it("should return undefined for unknown tool call", () => {
			expect(store.getStreamingArguments("unknown")).toBeUndefined();
		});
	});

	describe("clearStreamingArguments", () => {
		it("should clear streaming arguments", () => {
			store.createToolCallEntry("session1", {
				id: "tool1",
				name: "Edit",
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
				status: "pending",
				kind: "edit",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			applyStreamingArguments(store, "session1", "tool1", {
				kind: "edit",
				edits: [{ filePath: "/x", oldString: null, newString: "content", content: null }],
			});

			expect(store.getStreamingArguments("tool1")).toBeDefined();

			store.clearStreamingArguments("tool1");

			expect(store.getStreamingArguments("tool1")).toBeUndefined();
		});
	});

	describe("clearEntries", () => {
		it("should clear all streaming arguments for session", () => {
			store.createToolCallEntry("session1", {
				id: "tool1",
				name: "Bash",
				arguments: { kind: "execute", command: null },
				status: "pending",
				kind: "execute",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			store.createToolCallEntry("session1", {
				id: "tool2",
				name: "Bash",
				arguments: { kind: "execute", command: null },
				status: "pending",
				kind: "execute",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			store.createToolCallEntry("session2", {
				id: "tool3",
				name: "Bash",
				arguments: { kind: "execute", command: null },
				status: "pending",
				kind: "execute",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			applyStreamingArguments(store, "session1", "tool1", { kind: "execute", command: "a" });
			applyStreamingArguments(store, "session1", "tool2", { kind: "execute", command: "b" });
			applyStreamingArguments(store, "session2", "tool3", { kind: "execute", command: "c" });

			// Clear session1
			store.clearEntries("session1");

			// session1's tool calls should be cleared
			expect(store.getStreamingArguments("tool1")).toBeUndefined();
			expect(store.getStreamingArguments("tool2")).toBeUndefined();

			// session2's tool calls should remain
			expect(store.getStreamingArguments("tool3")).toEqual({ kind: "execute", command: "c" });
		});
	});
});

describe("SessionEntryStore - Transcript Deltas", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
	});

	it("hydrates transcript snapshots through the compatibility adapter", () => {
		const snapshot: TranscriptSnapshot = {
			revision: 5,
			entries: [
				{
					entryId: "assistant-1",
					role: "assistant",
					segments: [
						{
							kind: "text",
							segmentId: "assistant-1:segment:5",
							text: "hello",
						},
					],
				},
			],
		};

		store.replaceTranscriptSnapshot("session-1", snapshot, new Date("2026-04-16T00:00:00.000Z"));

		expect(store.getEntries("session-1")).toEqual([
			{
				id: "assistant-1",
				type: "assistant",
				message: {
					chunks: [
						{
							type: "message",
							block: {
								type: "text",
								text: "hello",
							},
						},
					],
				},
				timestamp: new Date("2026-04-16T00:00:00.000Z"),
			},
		]);
	});

	it("preserves structured tool data when a transcript snapshot rehydrates the same tool id", () => {
		const timestamp = new Date("2026-04-16T00:00:00.000Z");
		store.createToolCallEntry("session-1", {
			id: "tool-1",
			name: "Edit File",
			arguments: {
				kind: "edit",
				edits: [
					{
						filePath: "/tmp/example.ts",
						oldString: "before",
						newString: "after",
					},
				],
			},
			rawInput: {
				edits: [
					{
						filePath: "/tmp/example.ts",
						oldString: "before",
						newString: "after",
					},
				],
			},
			status: "completed",
			result: null,
			kind: "edit",
			title: "Edit File",
			locations: null,
			skillMeta: null,
			normalizedQuestions: null,
			normalizedTodos: null,
			parentToolUseId: null,
			taskChildren: null,
			questionAnswer: null,
			awaitingPlanApproval: false,
			planApprovalRequestId: null,
		});

		store.replaceTranscriptSnapshot(
			"session-1",
			{
				revision: 6,
				entries: [
					{
						entryId: "tool-1",
						role: "tool",
						segments: [
							{
								kind: "text",
								segmentId: "tool-1:tool",
								text: "Edit File",
							},
						],
					},
				],
			},
			timestamp
		);

		const [entry] = store.getEntries("session-1");
		expect(entry?.type).toBe("tool_call");
		if (entry?.type !== "tool_call") {
			throw new Error("expected tool call entry");
		}
		expect(entry.message).toMatchObject({
			id: "tool-1",
			name: "Edit File",
			kind: "edit",
			title: "Edit File",
			arguments: {
				kind: "edit",
				edits: [
					{
						filePath: "/tmp/example.ts",
						oldString: "before",
						newString: "after",
					},
				],
			},
		});
		expect(entry.message.arguments).toEqual({
			kind: "edit",
			edits: [
				{
					filePath: "/tmp/example.ts",
					oldString: "before",
					newString: "after",
				},
			],
		});
		expect(store.getOperationStore().getByToolCallId("session-1", "tool-1")).toMatchObject({
			toolCallId: "tool-1",
			kind: "edit",
		});
		expect(store.getOperationStore().getLastToolCall("session-1")).toMatchObject({
			id: "tool-1",
			kind: "edit",
		});
	});

	it("does not clear canonical tool operations when a delta replaces the transcript snapshot", () => {
		const timestamp = new Date("2026-04-16T00:00:00.000Z");
		store.createToolCallEntry("session-1", {
			id: "tool-1",
			name: "Edit File",
			arguments: {
				kind: "edit",
				edits: [
					{
						filePath: "/tmp/example.ts",
						oldString: "before",
						newString: "after",
					},
				],
			},
			rawInput: {
				edits: [
					{
						filePath: "/tmp/example.ts",
						oldString: "before",
						newString: "after",
					},
				],
			},
			status: "completed",
			result: null,
			kind: "edit",
			title: "Edit File",
			locations: null,
			skillMeta: null,
			normalizedQuestions: null,
			normalizedTodos: null,
			parentToolUseId: null,
			taskChildren: null,
			questionAnswer: null,
			awaitingPlanApproval: false,
			planApprovalRequestId: null,
		});

		store.applyTranscriptDelta(
			"session-1",
			{
				eventSeq: 6,
				sessionId: "session-1",
				snapshotRevision: 6,
				operations: [
					{
						kind: "replaceSnapshot",
						snapshot: {
							revision: 6,
							entries: [
								{
									entryId: "tool-1",
									role: "tool",
									segments: [
										{
											kind: "text",
											segmentId: "tool-1:tool",
											text: "Edit File",
										},
									],
								},
							],
						},
					},
				],
			},
			timestamp
		);

		expect(store.getOperationStore().getByToolCallId("session-1", "tool-1")).toMatchObject({
			toolCallId: "tool-1",
			kind: "edit",
		});
		expect(store.getOperationStore().getLastToolCall("session-1")).toMatchObject({
			id: "tool-1",
			kind: "edit",
		});
	});

	it("appends assistant transcript segments without rebuilding the whole session", () => {
		store.replaceTranscriptSnapshot(
			"session-1",
			{
				revision: 5,
				entries: [
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:segment:5",
								text: "hello",
							},
						],
					},
				],
			},
			new Date("2026-04-16T00:00:00.000Z")
		);

		const delta: TranscriptDelta = {
			eventSeq: 6,
			sessionId: "session-1",
			snapshotRevision: 6,
			operations: [
				{
					kind: "appendSegment",
					entryId: "assistant-1",
					role: "assistant",
					segment: {
						kind: "text",
						segmentId: "assistant-1:segment:6",
						text: " world",
					},
				},
			],
		};

		store.applyTranscriptDelta("session-1", delta, new Date("2026-04-16T00:00:01.000Z"));

		expect(store.getEntries("session-1")).toEqual([
			{
				id: "assistant-1",
				type: "assistant",
				message: {
					chunks: [
						{
							type: "message",
							block: {
								type: "text",
								text: "hello",
							},
						},
						{
							type: "message",
							block: {
								type: "text",
								text: " world",
							},
						},
					],
				},
				timestamp: new Date("2026-04-16T00:00:00.000Z"),
			},
		]);
	});

	it("applies user and tool transcript deltas with runtime side effects", () => {
		const operationStore = new OperationStore();
		store = new SessionEntryStore(operationStore);

		const delta: TranscriptDelta = {
			eventSeq: 7,
			sessionId: "session-1",
			snapshotRevision: 7,
			operations: [
				{
					kind: "appendEntry",
					entry: {
						entryId: "user-1",
						role: "user",
						segments: [{ kind: "text", segmentId: "user-1:block:0", text: "hello" }],
					},
				},
				{
					kind: "appendEntry",
					entry: {
						entryId: "tool-1",
						role: "tool",
						segments: [{ kind: "text", segmentId: "tool-1:tool", text: "Read file" }],
					},
				},
				{
					kind: "appendSegment",
					entryId: "tool-1",
					role: "tool",
					segment: { kind: "text", segmentId: "tool-1:tool:1", text: "stdout ready" },
				},
			],
		};

		store.applyTranscriptDelta("session-1", delta, new Date("2026-04-16T00:00:02.000Z"));

		expect(store.getEntries("session-1")).toEqual([
			{
				id: "user-1",
				type: "user",
				message: {
					id: "user-1",
					content: { type: "text", text: "hello" },
					chunks: [{ type: "text", text: "hello" }],
				},
				timestamp: new Date("2026-04-16T00:00:02.000Z"),
			},
			{
				id: "tool-1",
				type: "tool_call",
				message: {
					id: "tool-1",
					name: "Read file\nstdout ready",
					arguments: { kind: "other", raw: null },
					progressiveArguments: undefined,
					rawInput: null,
					status: "completed",
					result: null,
					kind: "other",
					title: "Read file\nstdout ready",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
					normalizedResult: null,
				},
				timestamp: new Date("2026-04-16T00:00:02.000Z"),
			},
		]);

		expect(operationStore.getByToolCallId("session-1", "tool-1")).toMatchObject({
			toolCallId: "tool-1",
			sourceEntryId: "tool-1",
			title: "Read file\nstdout ready",
		});
	});

	it("reconciles a canonical user append entry onto the optimistic user row", () => {
		store.addEntry("session-1", {
			id: "optimistic-user-local",
			type: "user",
			message: {
				id: "optimistic-user-local",
				content: { type: "text", text: "hello" },
				chunks: [{ type: "text", text: "hello" }],
				sentAt: new Date("2026-04-16T00:00:01.000Z"),
			},
			timestamp: new Date("2026-04-16T00:00:01.000Z"),
		});

		const delta: TranscriptDelta = {
			eventSeq: 7,
			sessionId: "session-1",
			snapshotRevision: 7,
			operations: [
				{
					kind: "appendEntry",
					entry: {
						entryId: "user-event-7",
						role: "user",
						segments: [{ kind: "text", segmentId: "user-event-7:block:0", text: "hello" }],
					},
				},
			],
		};

		store.applyTranscriptDelta("session-1", delta, new Date("2026-04-16T00:00:02.000Z"));

		expect(store.getEntries("session-1")).toEqual([
			{
				id: "user-event-7",
				type: "user",
				message: {
					id: "user-event-7",
					content: { type: "text", text: "hello" },
					chunks: [{ type: "text", text: "hello" }],
					sentAt: new Date("2026-04-16T00:00:01.000Z"),
				},
				timestamp: new Date("2026-04-16T00:00:01.000Z"),
			},
		]);
	});
});

// Helper to create proper user message content
function createUserMessage(text: string) {
	const contentBlock = { type: "text" as const, text };
	return { content: contentBlock, chunks: [contentBlock] };
}

describe("SessionEntryStore - Assistant/Tool Boundary", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
		store.storeEntriesAndBuildIndex("session1", []);
	});

	it("creates a new assistant entry after tool call boundary for the same messageId", async () => {
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "pre-tool thought " } },
			"msg-1",
			true
		);

		store.createToolCallEntry("session1", {
			id: "tool-1",
			name: "Read",
			arguments: { kind: "read", file_path: "/tmp/file.txt" },
			status: "completed",
			kind: "read",
			title: null,
			locations: null,
			skillMeta: null,
			result: null,
			awaitingPlanApproval: false,
		});

		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "post-tool final response" } },
			"msg-1",
			false
		);

		const entries = store.getEntries("session1");
		expect(entries).toHaveLength(3);
		expect(entries[0].type).toBe("assistant");
		expect(entries[1].type).toBe("tool_call");
		expect(entries[2].type).toBe("assistant");

		const lastAssistant = entries[2];
		expect(lastAssistant.id).not.toBe("msg-1");
		if (lastAssistant.type === "assistant") {
			expect(lastAssistant.message.chunks).toHaveLength(1);
			expect(lastAssistant.message.chunks[0].type).toBe("message");
			expect(lastAssistant.message.chunks[0].block).toEqual({
				type: "text",
				text: "post-tool final response",
			});
		}
	});

	it("merges multiple post-tool chunks with same messageId into one assistant entry", async () => {
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "pre-tool thought " } },
			"msg-2",
			true
		);

		store.createToolCallEntry("session1", {
			id: "tool-2",
			name: "Read",
			arguments: { kind: "read", file_path: "/tmp/file.txt" },
			status: "completed",
			kind: "read",
			title: null,
			locations: null,
			skillMeta: null,
			result: null,
			awaitingPlanApproval: false,
		});

		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "post-tool part 1 " } },
			"msg-2",
			false
		);
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "post-tool part 2" } },
			"msg-2",
			false
		);

		const entries = store.getEntries("session1");
		expect(entries).toHaveLength(3);
		expect(entries[0].type).toBe("assistant");
		expect(entries[1].type).toBe("tool_call");
		expect(entries[2].type).toBe("assistant");

		const postToolAssistant = entries[2];
		if (postToolAssistant.type === "assistant") {
			expect(postToolAssistant.message.chunks).toHaveLength(2);
			expect(postToolAssistant.message.chunks[0].block).toEqual({
				type: "text",
				text: "post-tool part 1 ",
			});
			expect(postToolAssistant.message.chunks[1].block).toEqual({
				type: "text",
				text: "post-tool part 2",
			});
		}
	});
});

describe("SessionEntryStore - Synchronous Entry Writes", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
	});

	describe("addEntry", () => {
		it("should make entries immediately available", () => {
			store.storeEntriesAndBuildIndex("session1", []);

			store.addEntry("session1", {
				id: "e1",
				type: "user",
				message: createUserMessage("Hello"),
				timestamp: new Date(),
			});

			store.addEntry("session1", {
				id: "e2",
				type: "user",
				message: createUserMessage("World"),
				timestamp: new Date(),
			});

			const entries = store.getEntries("session1");
			expect(entries).toHaveLength(2);
		});

		it("should handle updates and additions together", () => {
			store.storeEntriesAndBuildIndex("session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("Original"),
					timestamp: new Date(),
				},
			]);

			store.updateEntry("session1", 0, {
				id: "e1",
				type: "user",
				message: createUserMessage("Updated"),
				timestamp: new Date(),
			});

			store.addEntry("session1", {
				id: "e2",
				type: "user",
				message: createUserMessage("New"),
				timestamp: new Date(),
			});

			const entries = store.getEntries("session1");
			expect(entries).toHaveLength(2);
			expect((entries[0].message as { content: { text: string } }).content.text).toBe("Updated");
			expect((entries[1].message as { content: { text: string } }).content.text).toBe("New");
		});
	});

	describe("updateEntry", () => {
		it("should apply multiple updates to same index with last-write-wins", () => {
			store.storeEntriesAndBuildIndex("session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("Original"),
					timestamp: new Date(),
				},
			]);

			store.updateEntry("session1", 0, {
				id: "e1",
				type: "user",
				message: createUserMessage("Update 1"),
				timestamp: new Date(),
			});

			store.updateEntry("session1", 0, {
				id: "e1",
				type: "user",
				message: createUserMessage("Update 2 - final"),
				timestamp: new Date(),
			});

			const entries = store.getEntries("session1");
			expect((entries[0].message as { content: { text: string } }).content.text).toBe(
				"Update 2 - final"
			);
		});
	});

	describe("getEntries", () => {
		it("should return stored entries", () => {
			store.storeEntriesAndBuildIndex("session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("Test"),
					timestamp: new Date(),
				},
			]);

			const entries = store.getEntries("session1");
			expect(entries).toHaveLength(1);
		});

		it("collapses replayed tool-call entries with the same tool id during preload", () => {
			store.storeEntriesAndBuildIndex("session1", [
				{
					id: "entry-tool-1-a",
					type: "tool_call",
					message: {
						id: "tool-1",
						name: "Run",
						arguments: { kind: "execute", command: "git status" },
						status: "pending",
						kind: "execute",
						title: "Check status",
						locations: null,
						skillMeta: null,
						result: null,
						awaitingPlanApproval: false,
					},
					timestamp: new Date(1),
				},
				{
					id: "entry-tool-1-b",
					type: "tool_call",
					message: {
						id: "tool-1",
						name: "Run",
						arguments: { kind: "execute", command: "git status" },
						status: "pending",
						kind: "execute",
						title: "Check status",
						locations: null,
						skillMeta: null,
						result: null,
						awaitingPlanApproval: false,
					},
					timestamp: new Date(2),
				},
			]);

			const toolEntries = store
				.getEntries("session1")
				.filter((entry) => entry.type === "tool_call");
			expect(toolEntries).toHaveLength(1);
		});

		it("rebuilds normalized results when tool-call history is preloaded", () => {
			store.storeEntriesAndBuildIndex("session1", [
				{
					id: "entry-tool-1",
					type: "tool_call",
					message: {
						id: "tool-1",
						name: "Run",
						arguments: { kind: "execute", command: "pwd" },
						status: "completed",
						kind: "execute",
						title: "pwd",
						locations: null,
						skillMeta: null,
						result: {
							content: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
							detailedContent: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
						},
						awaitingPlanApproval: false,
					},
					timestamp: new Date(1),
				},
			]);

			const entries = store.getEntries("session1");
			expect(entries).toHaveLength(1);
			const toolEntry = entries[0];
			expect(toolEntry?.type).toBe("tool_call");
			if (toolEntry?.type === "tool_call") {
				expect(toolEntry.message.normalizedResult).toEqual({
					kind: "execute",
					stdout: "/Users/alex/Documents/acepe",
					stderr: null,
					exitCode: 0,
				});
			}
		});

		it("rebuilds normalized results for preloaded tools whose canonical kind must be inferred from arguments", () => {
			store.storeEntriesAndBuildIndex("session1", [
				{
					id: "entry-tool-1",
					type: "tool_call",
					message: {
						id: "tool-1",
						name: "Run",
						arguments: { kind: "execute", command: "pwd" },
						status: "completed",
						kind: "other",
						title: "pwd",
						locations: null,
						skillMeta: null,
						result: {
							content: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
							detailedContent: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
						},
						awaitingPlanApproval: false,
					},
					timestamp: new Date(1),
				},
			]);

			const entries = store.getEntries("session1");
			expect(entries).toHaveLength(1);
			const toolEntry = entries[0];
			expect(toolEntry?.type).toBe("tool_call");
			if (toolEntry?.type === "tool_call") {
				expect(toolEntry.message.normalizedResult).toEqual({
					kind: "execute",
					stdout: "/Users/alex/Documents/acepe",
					stderr: null,
					exitCode: 0,
				});
			}
		});

		it("should see updates immediately", () => {
			store.storeEntriesAndBuildIndex("session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("Original"),
					timestamp: new Date(),
				},
			]);

			store.updateEntry("session1", 0, {
				id: "e1",
				type: "user",
				message: createUserMessage("Updated"),
				timestamp: new Date(),
			});

			const entries = store.getEntries("session1");
			expect((entries[0].message as { content: { text: string } }).content.text).toBe("Updated");
		});

		it("should see additions immediately", () => {
			store.storeEntriesAndBuildIndex("session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("First"),
					timestamp: new Date(),
				},
			]);

			store.addEntry("session1", {
				id: "e2",
				type: "user",
				message: createUserMessage("Second"),
				timestamp: new Date(),
			});

			const entries = store.getEntries("session1");
			expect(entries).toHaveLength(2);
		});
	});
});

describe("SessionEntryStore - Rapid Streaming Chunk Aggregation", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
		store.storeEntriesAndBuildIndex("session1", []);
	});

	it("should merge all chunks with same messageId into one assistant entry", async () => {
		const messageId = "msg-streaming-test";

		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "The " } },
			messageId,
			false
		);
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "quick " } },
			messageId,
			false
		);
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "brown " } },
			messageId,
			false
		);
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "fox" } },
			messageId,
			false
		);

		const entries = store.getEntries("session1");

		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe("assistant");

		if (entries[0].type === "assistant") {
			expect(entries[0].message.chunks).toHaveLength(4);
			expect(entries[0].message.chunks[0].block).toEqual({ type: "text", text: "The " });
			expect(entries[0].message.chunks[1].block).toEqual({ type: "text", text: "quick " });
			expect(entries[0].message.chunks[2].block).toEqual({ type: "text", text: "brown " });
			expect(entries[0].message.chunks[3].block).toEqual({ type: "text", text: "fox" });
		}
	});

	it("should merge all chunks with same messageId across multiple calls", async () => {
		const messageId = "msg-across-calls";

		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "First " } },
			messageId,
			false
		);
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "batch " } },
			messageId,
			false
		);
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "second " } },
			messageId,
			false
		);
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "batch" } },
			messageId,
			false
		);

		const entries = store.getEntries("session1");

		// Should be ONE entry with all 4 chunks
		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe("assistant");

		if (entries[0].type === "assistant") {
			expect(entries[0].message.chunks).toHaveLength(4);
		}
	});

	it("should create separate entries for different messageIds", async () => {
		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "Message 1" } },
			"msg-1",
			false
		);

		await store.aggregateAssistantChunk(
			"session1",
			{ content: { type: "text", text: "Message 2" } },
			"msg-2",
			false
		);

		const entries = store.getEntries("session1");

		// Different messageIds should create separate entries
		expect(entries).toHaveLength(2);
		expect(entries[0].id).toBe("msg-1");
		expect(entries[1].id).toBe("msg-2");
	});
});
