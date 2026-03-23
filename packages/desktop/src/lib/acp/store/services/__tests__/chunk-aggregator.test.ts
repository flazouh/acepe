import { beforeEach, describe, expect, it, vi } from "bun:test";
import type { SessionEntry } from "../../types.js";
import { ChunkAggregator } from "../chunk-aggregator.js";
import type { IEntryIndex } from "../interfaces/entry-index.js";
import type { IEntryStoreInternal } from "../interfaces/entry-store-internal.js";

// ==========================================
// Mock factories
// ==========================================

function createMockEntryStore(overrides: Partial<IEntryStoreInternal> = {}): IEntryStoreInternal {
	return {
		getEntries: vi.fn(() => []),
		addEntry: vi.fn(),
		updateEntry: vi.fn(),
		hasSession: vi.fn(() => true),
		...overrides,
	};
}

function createMockEntryIndex(overrides: Partial<IEntryIndex> = {}): IEntryIndex {
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

function createAssistantEntry(
	id: string,
	chunks: { type: string; block: { type: "text"; text: string } }[] = []
): SessionEntry {
	return {
		id,
		type: "assistant" as const,
		message: {
			chunks:
				chunks.length > 0
					? chunks.map((c) => ({
							type: c.type as "thought" | "message",
							block: c.block,
						}))
					: [{ type: "message" as const, block: { type: "text" as const, text: "existing" } }],
		},
		timestamp: new Date(),
	};
}

function createUserEntry(id: string): SessionEntry {
	return {
		id,
		type: "user" as const,
		message: {
			content: { type: "text" as const, text: "user message" },
			chunks: [{ type: "text" as const, text: "user message" }],
		},
		timestamp: new Date(),
	};
}

describe("ChunkAggregator", () => {
	let mockStore: IEntryStoreInternal;
	let mockIndex: IEntryIndex;
	let aggregator: ChunkAggregator;

	beforeEach(() => {
		mockStore = createMockEntryStore();
		mockIndex = createMockEntryIndex();
		aggregator = new ChunkAggregator(mockStore, mockIndex);
	});

	// ==========================================
	// aggregateAssistantChunk
	// ==========================================

	describe("aggregateAssistantChunk", () => {
		it("creates new assistant entry for first chunk", async () => {
			const result = await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "Hello" } },
				"msg-1",
				false
			);

			expect(result.isOk()).toBe(true);
			expect(mockStore.addEntry).toHaveBeenCalledTimes(1);

			const addedEntry = (mockStore.addEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][1] as SessionEntry;
			expect(addedEntry.id).toBe("msg-1");
			expect(addedEntry.type).toBe("assistant");
			if (addedEntry.type === "assistant") {
				expect(addedEntry.message.chunks[0].block).toEqual({ type: "text", text: "Hello" });
				expect(addedEntry.message.chunks[0].type).toBe("message");
			}
		});

		it("merges chunk into existing entry", async () => {
			// Simulate: entry starts absent, then appears in entries after addEntry
			let entries: SessionEntry[] = [];
			mockStore = createMockEntryStore({
				getEntries: vi.fn(() => entries),
				addEntry: vi.fn((_sid: string, entry: SessionEntry) => {
					entries = [entry];
				}),
			});
			aggregator = new ChunkAggregator(mockStore, mockIndex);

			// First chunk creates entry
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "First " } },
				"msg-1",
				false
			);

			// Second chunk should merge (entry now in entries)
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "second" } },
				"msg-1",
				false
			);

			expect(mockStore.addEntry).toHaveBeenCalledTimes(1); // Only first creates
			expect(mockStore.updateEntry).toHaveBeenCalledTimes(1); // Second merges
		});

		it("returns ValidationError for invalid chunk input", async () => {
			const result = await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "test" } },
				"msg-1",
				"not-a-boolean" as unknown as boolean
			);

			expect(result.isErr()).toBe(true);
		});

		it("returns SessionNotFoundError for unknown session", async () => {
			mockStore = createMockEntryStore({ hasSession: vi.fn(() => false) });
			aggregator = new ChunkAggregator(mockStore, mockIndex);

			const result = await aggregator.aggregateAssistantChunk(
				"unknown-session",
				{ content: { type: "text", text: "test" } },
				"msg-1",
				false
			);

			expect(result.isErr()).toBe(true);
		});

		it("normalizes thought chunks by stripping prefix", async () => {
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "[Thinking] Let me check." } },
				"msg-1",
				true
			);

			const addedEntry = (mockStore.addEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][1] as SessionEntry;
			if (addedEntry.type === "assistant") {
				expect(addedEntry.message.chunks[0].type).toBe("thought");
				expect(addedEntry.message.chunks[0].block).toEqual({ type: "text", text: "Let me check." });
			}
		});

		it("recovers when message index points to the wrong entry", async () => {
			const wrongEntry = createAssistantEntry("wrong-id");
			const targetEntry = createAssistantEntry("msg-1", [
				{ type: "message", block: { type: "text", text: "Hello " } },
			]);

			mockStore = createMockEntryStore({
				getEntries: vi.fn(() => [wrongEntry, targetEntry]),
			});
			mockIndex = createMockEntryIndex({
				getMessageIdIndex: vi.fn(() => 0),
			});
			aggregator = new ChunkAggregator(mockStore, mockIndex);

			const result = await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "world" } },
				"msg-1",
				false
			);

			expect(result.isOk()).toBe(true);
			expect(mockStore.updateEntry).toHaveBeenCalledTimes(1);
			expect(mockStore.addEntry).not.toHaveBeenCalled();
			expect(mockIndex.addMessageId).toHaveBeenCalledWith("session1", "msg-1", 1);
		});

		it("detects implicit thought from [Thinking] prefix in message", async () => {
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "[Thinking] Implicit thought." } },
				"msg-1",
				false // Not explicitly marked as thought
			);

			const addedEntry = (mockStore.addEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][1] as SessionEntry;
			if (addedEntry.type === "assistant") {
				expect(addedEntry.message.chunks[0].type).toBe("thought");
				expect(addedEntry.message.chunks[0].block).toEqual({
					type: "text",
					text: "Implicit thought.",
				});
			}
		});
	});

	// ==========================================
	// aggregateUserChunk
	// ==========================================

	describe("aggregateUserChunk", () => {
		it("creates new user entry when no existing user entry", async () => {
			const result = await aggregator.aggregateUserChunk("session1", {
				content: { type: "text", text: "Hello" },
			});

			expect(result.isOk()).toBe(true);
			expect(mockStore.addEntry).toHaveBeenCalledTimes(1);

			const addedEntry = (mockStore.addEntry as ReturnType<typeof vi.fn>).mock
				.calls[0][1] as SessionEntry;
			expect(addedEntry.type).toBe("user");
		});

		it("merges into existing user entry", async () => {
			const existing = createUserEntry("user-1");
			mockStore = createMockEntryStore({
				getEntries: vi.fn(() => [existing]),
			});
			aggregator = new ChunkAggregator(mockStore, mockIndex);

			const result = await aggregator.aggregateUserChunk("session1", {
				content: { type: "text", text: " more" },
			});

			expect(result.isOk()).toBe(true);
			expect(mockStore.updateEntry).toHaveBeenCalledTimes(1);
			expect(mockStore.addEntry).not.toHaveBeenCalled();
		});

		it("drops mirrored duplicate chunk after optimistic user entry", async () => {
			const existing = {
				id: "user-1",
				type: "user" as const,
				message: {
					content: { type: "text" as const, text: "Hi what is this repo ?" },
					chunks: [{ type: "text" as const, text: "Hi what is this repo ?" }],
				},
				timestamp: new Date(),
			} satisfies SessionEntry;
			mockStore = createMockEntryStore({
				getEntries: vi.fn(() => [existing]),
			});
			aggregator = new ChunkAggregator(mockStore, mockIndex);

			const result = await aggregator.aggregateUserChunk("session1", {
				content: { type: "text", text: "Hi what is this repo ?" },
			});

			expect(result.isOk()).toBe(true);
			expect(mockStore.updateEntry).not.toHaveBeenCalled();
			expect(mockStore.addEntry).not.toHaveBeenCalled();
		});

		it("still merges when existing user entry already has multiple chunks", async () => {
			const existing = {
				id: "user-1",
				type: "user" as const,
				message: {
					content: { type: "text" as const, text: "Hi what is this repo ?" },
					chunks: [
						{ type: "text" as const, text: "Hi " },
						{ type: "text" as const, text: "what is this repo ?" },
					],
				},
				timestamp: new Date(),
			} satisfies SessionEntry;
			mockStore = createMockEntryStore({
				getEntries: vi.fn(() => [existing]),
			});
			aggregator = new ChunkAggregator(mockStore, mockIndex);

			const result = await aggregator.aggregateUserChunk("session1", {
				content: { type: "text", text: "!" },
			});

			expect(result.isOk()).toBe(true);
			expect(mockStore.updateEntry).toHaveBeenCalledTimes(1);
		});

		it("returns SessionNotFoundError for unknown session", async () => {
			mockStore = createMockEntryStore({ hasSession: vi.fn(() => false) });
			aggregator = new ChunkAggregator(mockStore, mockIndex);

			const result = await aggregator.aggregateUserChunk("unknown", {
				content: { type: "text", text: "test" },
			});

			expect(result.isErr()).toBe(true);
		});

		it("does not merge if latest entry is not a user entry", async () => {
			const assistant = createAssistantEntry("asst-1");
			mockStore = createMockEntryStore({
				getEntries: vi.fn(() => [assistant]),
			});
			aggregator = new ChunkAggregator(mockStore, mockIndex);

			const result = await aggregator.aggregateUserChunk("session1", {
				content: { type: "text", text: "Hello" },
			});

			expect(result.isOk()).toBe(true);
			expect(mockStore.addEntry).toHaveBeenCalledTimes(1); // Creates new
		});
	});

	// ==========================================
	// splitAssistantAggregationBoundary
	// ==========================================

	describe("splitAssistantAggregationBoundary", () => {
		it("marks current messageId as boundary", async () => {
			// Set up state by aggregating a chunk
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "thinking..." } },
				"msg-1",
				true
			);

			aggregator.splitAssistantAggregationBoundary("session1");

			// Subsequent chunk with same messageId should create new entry
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "after tool" } },
				"msg-1",
				false
			);

			// Should have called addEntry twice (first chunk + post-boundary chunk)
			expect(mockStore.addEntry).toHaveBeenCalledTimes(2);
		});

		it("splits boundary without mutating message index entries", async () => {
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "hello" } },
				"msg-1",
				false
			);

			aggregator.splitAssistantAggregationBoundary("session1");

			expect(mockIndex.deleteMessageId).not.toHaveBeenCalled();
		});

		it("is a no-op when no active message", () => {
			aggregator.splitAssistantAggregationBoundary("session1");

			expect(mockIndex.deleteMessageId).not.toHaveBeenCalled();
		});
	});

	// ==========================================
	// clearStreamingAssistantEntry
	// ==========================================

	describe("clearStreamingAssistantEntry", () => {
		it("clears aggregation state for session", async () => {
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "hello" } },
				"msg-1",
				false
			);

			aggregator.clearStreamingAssistantEntry("session1");

			// Next chunk should create fresh entry (no lastKnownMessageId)
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "fresh" } },
				"msg-2",
				false
			);

			expect(mockStore.addEntry).toHaveBeenCalledTimes(2);
		});
	});

	// ==========================================
	// clearSession
	// ==========================================

	describe("clearSession", () => {
		it("clears all state for the session", async () => {
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "hello" } },
				"msg-1",
				false
			);

			aggregator.clearSession("session1");

			// Aggregation state should be fresh
			await aggregator.aggregateAssistantChunk(
				"session1",
				{ content: { type: "text", text: "new start" } },
				"msg-2",
				false
			);

			expect(mockStore.addEntry).toHaveBeenCalledTimes(2);
		});
	});
});
