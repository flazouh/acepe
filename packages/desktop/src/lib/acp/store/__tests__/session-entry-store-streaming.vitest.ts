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

import type { TranscriptDelta, TranscriptSnapshot } from "../../../services/acp-types.js";
import { OperationStore } from "../operation-store.svelte.js";
import { SessionEntryStore } from "../session-entry-store.svelte.js";
import {
	preloadEntriesAndBuildIndex,
	readStoredEntries,
} from "./entry-store-test-access.js";

describe("SessionEntryStore - Transcript Deltas", () => {
	let store: SessionEntryStore;
	let operationStore: OperationStore;

	beforeEach(() => {
		operationStore = new OperationStore();
		store = new SessionEntryStore(operationStore);
	});

	it("hydrates transcript snapshots into spine entries", () => {
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

		expect(readStoredEntries(store, "session-1")).toEqual([
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

	it("keeps transcript snapshot tool rows as spine entries instead of preserving structured operation data", () => {
		const timestamp = new Date("2026-04-16T00:00:00.000Z");
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

		const [entry] = readStoredEntries(store, "session-1");
		expect(entry?.type).toBe("tool_call");
		if (entry?.type !== "tool_call") {
			throw new Error("expected tool call entry");
		}
		expect(entry.message).toMatchObject({
			id: "tool-1",
			name: "Edit File",
			kind: "other",
			title: "Edit File",
			arguments: {
				kind: "other",
				raw: null,
			},
		});
		expect(entry.message.arguments).toEqual({
			kind: "other",
			raw: null,
		});
		expect(operationStore.getByToolCallId("session-1", "tool-1")).toBeUndefined();
		expect(operationStore.getLastToolCall("session-1")).toBeNull();
	});

	it("does not clear canonical tool operations when a delta replaces the transcript snapshot", () => {
		const timestamp = new Date("2026-04-16T00:00:00.000Z");
		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-tool-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				operation_provenance_key: "tool-1",
				name: "Edit File",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/tmp/example.ts",
							oldString: "before",
							newString: "after",
							content: null,
						},
					],
				},
				provider_status: "completed",
				operation_state: "completed",
	awaiting_plan_approval: false,
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
				result: null,
				kind: "edit",
				title: "Edit File",
				progressive_arguments: null,
				command: null,
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

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

		expect(operationStore.getByToolCallId("session-1", "tool-1")).toMatchObject({
			toolCallId: "tool-1",
			kind: "edit",
		});
		expect(operationStore.getLastToolCall("session-1")).toMatchObject({
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

		expect(readStoredEntries(store, "session-1")).toEqual([
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

	it("appends a single transcript delta without iterating the whole stored entry list", () => {
		store.replaceTranscriptSnapshot(
			"session-1",
			{
				revision: 5,
				entries: [
					{
						entryId: "user-1",
						role: "user",
						segments: [{ kind: "text", segmentId: "user-1:block:0", text: "hello" }],
					},
				],
			},
			new Date("2026-04-16T00:00:00.000Z")
		);
		const entries = readStoredEntries(store, "session-1");
		const originalIterator = entries[Symbol.iterator];

		entries[Symbol.iterator] = function* () {
			throw new Error("must not iterate whole stored entry list");
		};

		try {
			store.applyTranscriptDelta(
				"session-1",
				{
					eventSeq: 6,
					sessionId: "session-1",
					snapshotRevision: 6,
					operations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-1:segment:0",
										text: "hi",
									},
								],
							},
						},
					],
				},
				new Date("2026-04-16T00:00:01.000Z")
			);

			const nextEntries = readStoredEntries(store, "session-1");
			expect(Array.isArray(nextEntries)).toBe(true);
			expect(nextEntries).toHaveLength(2);
			expect(nextEntries[0]).toBe(entries[0]);
			expect(nextEntries[1]).toMatchObject({
				id: "assistant-1",
				type: "assistant",
			});
			expect(nextEntries.map((entry) => entry.id)).toEqual(["user-1", "assistant-1"]);
		} finally {
			entries[Symbol.iterator] = originalIterator;
		}
	});

	it("patches a single transcript segment without iterating the whole stored entry list", () => {
		store.replaceTranscriptSnapshot(
			"session-1",
			{
				revision: 5,
				entries: [
					{
						entryId: "user-1",
						role: "user",
						segments: [{ kind: "text", segmentId: "user-1:block:0", text: "hello" }],
					},
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:segment:0",
								text: "hi",
							},
						],
					},
				],
			},
			new Date("2026-04-16T00:00:00.000Z")
		);
		const entries = readStoredEntries(store, "session-1");
		const originalIterator = entries[Symbol.iterator];

		entries[Symbol.iterator] = function* () {
			throw new Error("must not iterate whole stored entry list");
		};

		try {
			store.applyTranscriptDelta(
				"session-1",
				{
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
								segmentId: "assistant-1:segment:1",
								text: " there",
							},
						},
					],
				},
				new Date("2026-04-16T00:00:01.000Z")
			);

			const nextEntries = readStoredEntries(store, "session-1");
			expect(Array.isArray(nextEntries)).toBe(true);
			expect(nextEntries).toHaveLength(2);
			expect(nextEntries[0]).toBe(entries[0]);
			expect(nextEntries[1]).not.toBe(entries[1]);
			expect(nextEntries[1]?.type).toBe("assistant");
			if (nextEntries[1]?.type !== "assistant") {
				throw new Error("expected assistant entry");
			}
			expect(nextEntries[1].message.chunks).toEqual([
				{ type: "message", block: { type: "text", text: "hi" } },
				{ type: "message", block: { type: "text", text: " there" } },
			]);
		} finally {
			entries[Symbol.iterator] = originalIterator;
		}
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

		expect(readStoredEntries(store, "session-1")).toEqual([
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
				isStreaming: undefined,
			},
		]);

		expect(operationStore.getByToolCallId("session-1", "tool-1")).toBeUndefined();
		expect(operationStore.getSessionOperations("session-1")).toHaveLength(0);
	});

	it("commits multi-operation transcript deltas once while preserving unchanged entries", () => {
		store.replaceTranscriptSnapshot(
			"session-1",
			{
				revision: 5,
				entries: [
					{
						entryId: "user-1",
						role: "user",
						segments: [{ kind: "text", segmentId: "user-1:block:0", text: "hello" }],
					},
				],
			},
			new Date("2026-04-16T00:00:00.000Z")
		);
		const firstEntry = readStoredEntries(store, "session-1")[0];
		const storage = store as unknown as {
			entriesById: {
				set(sessionId: string, entries: unknown[]): unknown;
			};
			entryIndex: {
				rebuildEntryIdIndex(sessionId: string, entries: unknown[]): void;
				rebuildToolCallIdIndex(sessionId: string, entries: unknown[]): void;
			};
		};
		const originalSet = storage.entriesById.set.bind(storage.entriesById);
		const setSpy = vi.fn(originalSet);
		storage.entriesById.set = setSpy;
		const rebuildEntryIdIndexSpy = vi.spyOn(storage.entryIndex, "rebuildEntryIdIndex");
		const rebuildToolCallIdIndexSpy = vi.spyOn(storage.entryIndex, "rebuildToolCallIdIndex");

		store.applyTranscriptDelta(
			"session-1",
			{
				eventSeq: 6,
				sessionId: "session-1",
				snapshotRevision: 6,
				operations: [
					{
						kind: "appendEntry",
						entry: {
							entryId: "assistant-1",
							role: "assistant",
							segments: [
								{
									kind: "text",
									segmentId: "assistant-1:segment:0",
									text: "hi",
								},
							],
						},
					},
					{
						kind: "appendSegment",
						entryId: "assistant-1",
						role: "assistant",
						segment: {
							kind: "text",
							segmentId: "assistant-1:segment:1",
							text: " there",
						},
					},
				],
			},
			new Date("2026-04-16T00:00:01.000Z")
		);

		const entries = readStoredEntries(store, "session-1");
		expect(setSpy).toHaveBeenCalledTimes(1);
		expect(rebuildEntryIdIndexSpy).not.toHaveBeenCalled();
		expect(rebuildToolCallIdIndexSpy).not.toHaveBeenCalled();
		expect(entries[0]).toBe(firstEntry);
		expect(entries[1]).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			message: {
				chunks: [
					{ type: "message", block: { type: "text", text: "hi" } },
					{ type: "message", block: { type: "text", text: " there" } },
				],
			},
		});

		storage.entriesById.set = originalSet;
		rebuildEntryIdIndexSpy.mockRestore();
		rebuildToolCallIdIndexSpy.mockRestore();
	});

	it("does not reconcile canonical user append entries by matching optimistic text", () => {
		store.appendTranscriptEntry("session-1", {
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

		expect(readStoredEntries(store, "session-1")).toEqual([
			{
				id: "optimistic-user-local",
				type: "user",
				message: {
					id: "optimistic-user-local",
					content: { type: "text", text: "hello" },
					chunks: [{ type: "text", text: "hello" }],
					sentAt: new Date("2026-04-16T00:00:01.000Z"),
				},
				timestamp: new Date("2026-04-16T00:00:01.000Z"),
			},
			{
				id: "user-event-7",
				type: "user",
				message: {
					id: "user-event-7",
					content: { type: "text", text: "hello" },
					chunks: [{ type: "text", text: "hello" }],
				},
				timestamp: new Date("2026-04-16T00:00:02.000Z"),
			},
		]);
	});

	it("appends canonical user entries even when matching optimistic text exists before assistant output", () => {
		store.appendTranscriptEntry("session-1", {
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
		store.appendTranscriptEntry("session-1", {
			id: "assistant-1",
			type: "assistant",
			message: {
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "response" },
					},
				],
			},
			timestamp: new Date("2026-04-16T00:00:02.000Z"),
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

		store.applyTranscriptDelta("session-1", delta, new Date("2026-04-16T00:00:03.000Z"));

		expect(readStoredEntries(store, "session-1").map((entry) => entry.id)).toEqual([
			"optimistic-user-local",
			"assistant-1",
			"user-event-7",
		]);
		expect(readStoredEntries(store, "session-1")[2]).toMatchObject({
			id: "user-event-7",
			type: "user",
		});
	});
});

// Helper to create proper user message content
function createUserMessage(text: string) {
	const contentBlock = { type: "text" as const, text };
	return { content: contentBlock, chunks: [contentBlock] };
}


describe("SessionEntryStore - Synchronous Entry Writes", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
	});

	describe("appendTranscriptEntry", () => {
		it("should make entries immediately available", () => {
			preloadEntriesAndBuildIndex(store, "session1", []);

			store.appendTranscriptEntry("session1", {
				id: "e1",
				type: "user",
				message: createUserMessage("Hello"),
				timestamp: new Date(),
			});

			store.appendTranscriptEntry("session1", {
				id: "e2",
				type: "user",
				message: createUserMessage("World"),
				timestamp: new Date(),
			});

			const entries = readStoredEntries(store, "session1");
			expect(entries).toHaveLength(2);
		});

		it("should handle updates and additions together", () => {
			preloadEntriesAndBuildIndex(store, "session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("Original"),
					timestamp: new Date(),
				},
			]);

			store.replaceTranscriptEntry("session1", 0, {
				id: "e1",
				type: "user",
				message: createUserMessage("Updated"),
				timestamp: new Date(),
			});

			store.appendTranscriptEntry("session1", {
				id: "e2",
				type: "user",
				message: createUserMessage("New"),
				timestamp: new Date(),
			});

			const entries = readStoredEntries(store, "session1");
			expect(entries).toHaveLength(2);
			expect((entries[0].message as { content: { text: string } }).content.text).toBe("Updated");
			expect((entries[1].message as { content: { text: string } }).content.text).toBe("New");
		});
	});

	describe("replaceTranscriptEntry", () => {
		it("should apply multiple updates to same index with last-write-wins", () => {
			preloadEntriesAndBuildIndex(store, "session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("Original"),
					timestamp: new Date(),
				},
			]);

			store.replaceTranscriptEntry("session1", 0, {
				id: "e1",
				type: "user",
				message: createUserMessage("Update 1"),
				timestamp: new Date(),
			});

			store.replaceTranscriptEntry("session1", 0, {
				id: "e1",
				type: "user",
				message: createUserMessage("Update 2 - final"),
				timestamp: new Date(),
			});

			const entries = readStoredEntries(store, "session1");
			expect((entries[0].message as { content: { text: string } }).content.text).toBe(
				"Update 2 - final"
			);
		});
	});

	describe("projected entry reads", () => {
		it("should return stored entries", () => {
			preloadEntriesAndBuildIndex(store, "session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("Test"),
					timestamp: new Date(),
				},
			]);

			const entries = readStoredEntries(store, "session1");
			expect(entries).toHaveLength(1);
		});

		it("preserves replayed tool-call entries with the same tool id during preload", () => {
			preloadEntriesAndBuildIndex(store, "session1", [
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

			const toolEntries = readStoredEntries(store, "session1")
				.filter((entry) => entry.type === "tool_call");
			expect(toolEntries).toHaveLength(2);
		});

		it("rebuilds normalized results when tool-call history is preloaded", () => {
			preloadEntriesAndBuildIndex(store, "session1", [
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

			const entries = readStoredEntries(store, "session1");
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
			preloadEntriesAndBuildIndex(store, "session1", [
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

			const entries = readStoredEntries(store, "session1");
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
			preloadEntriesAndBuildIndex(store, "session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("Original"),
					timestamp: new Date(),
				},
			]);

			store.replaceTranscriptEntry("session1", 0, {
				id: "e1",
				type: "user",
				message: createUserMessage("Updated"),
				timestamp: new Date(),
			});

			const entries = readStoredEntries(store, "session1");
			expect((entries[0].message as { content: { text: string } }).content.text).toBe("Updated");
		});

		it("should see additions immediately", () => {
			preloadEntriesAndBuildIndex(store, "session1", [
				{
					id: "e1",
					type: "user",
					message: createUserMessage("First"),
					timestamp: new Date(),
				},
			]);

			store.appendTranscriptEntry("session1", {
				id: "e2",
				type: "user",
				message: createUserMessage("Second"),
				timestamp: new Date(),
			});

			const entries = readStoredEntries(store, "session1");
			expect(entries).toHaveLength(2);
		});
	});
});
