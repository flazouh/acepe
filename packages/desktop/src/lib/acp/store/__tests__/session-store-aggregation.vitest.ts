/**
 * NOTE: This test file tests methods that have been refactored from SessionStore to SessionEntryStore.
 * The methods like createNewAssistantEntry, mergeChunkIntoEntry, findAssistantEntryByMessageId are
 * now on SessionEntryStore, not SessionStore.
 *
 * See session-entry-store-streaming.vitest.ts for comprehensive batching tests.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { SessionStore } from "../session-store.svelte.js";

// Stub for skipped tests
function flushBatchedUpdates() {}

// Skip these tests - methods have been moved to SessionEntryStore
// See session-entry-store-streaming.vitest.ts for entry batching tests
describe.skip("SessionStore chunk aggregation (DEPRECATED - methods moved to SessionEntryStore)", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		// Add a mock session (cold data only - entries come from entryStore)
		(store as any).sessions = [
			{
				id: "session-123",
				projectPath: "/test",
				agentId: "claude-code",
				title: "Test",
				status: "ready",
				// Note: entries are NOT stored here - they come from entryStore
				currentMode: null,
				currentModel: null,
				taskProgress: null,
				acpSessionId: "session-123",
				updatedAt: new Date(),
				createdAt: new Date(),
			},
		];
		// Initialize the entry store for this session (entries are stored separately)
		(store as any).entryStore.storeEntriesAndBuildIndex("session-123", []);
		// Initialize hot state
		(store as any).hotStateStore.initializeHotState("session-123", {
			isConnected: true,
			isStreaming: false,
		});
		// Initialize capabilities
		(store as any).capabilitiesStore.setCapabilities("session-123", {
			availableModes: [],
			availableModels: [],
			availableCommands: [],
		});
	});

	describe("findAssistantEntryByMessageId", () => {
		it("returns null when messageId is undefined", () => {
			const result = (store as any).findAssistantEntryByMessageId([], undefined);
			expect(result.isOk()).toBe(true);
			expect(result.value).toBeNull();
		});

		it("returns null when no matching entry exists", () => {
			const entries = [{ id: "other-id", type: "assistant", message: { chunks: [] } }];
			const result = (store as any).findAssistantEntryByMessageId(entries, "msg_123");
			expect(result.isOk()).toBe(true);
			expect(result.value).toBeNull();
		});

		it("returns entry when messageId matches", () => {
			const entries = [{ id: "msg_123", type: "assistant", message: { chunks: [] } }];
			const result = (store as any).findAssistantEntryByMessageId(entries, "msg_123");
			expect(result.isOk()).toBe(true);
			expect(result.value).toEqual({ entry: entries[0], index: 0 });
		});

		it("ignores non-assistant entries with matching id", () => {
			const entries = [
				{ id: "msg_123", type: "user", message: { content: { type: "text", text: "hi" } } },
			];
			const result = (store as any).findAssistantEntryByMessageId(entries, "msg_123");
			expect(result.isOk()).toBe(true);
			expect(result.value).toBeNull();
		});
	});

	describe("createNewAssistantEntry", () => {
		it("creates entry with messageId as id", async () => {
			const input = {
				sessionId: "session-123",
				messageId: "msg_abc",
				content: { type: "text" as const, text: "Hello" },
				isThought: false,
			};

			const result = await (store as any).createNewAssistantEntry("session-123", input);
			flushBatchedUpdates(); // Flush batched entry additions

			expect(result.isOk()).toBe(true);
			const session = store.getSessionCold("session-123");
			expect(session).toBeDefined();
			const entries = store.getEntries("session-123");
			expect(entries.length).toBe(1);
			expect(entries[0].id).toBe("msg_abc");
			expect(entries[0].type).toBe("assistant");
		});

		it("creates entry with generated id when messageId is undefined", async () => {
			const input = {
				sessionId: "session-123",
				content: { type: "text" as const, text: "Hello" },
				isThought: false,
			};

			const result = await (store as any).createNewAssistantEntry("session-123", input);
			flushBatchedUpdates(); // Flush batched entry additions

			expect(result.isOk()).toBe(true);
			const session = store.getSessionCold("session-123");
			expect(session).toBeDefined();
			const entries = store.getEntries("session-123");
			expect(entries.length).toBe(1);
			expect(entries[0].id).toBeDefined();
			expect(entries[0].id.length).toBeGreaterThan(0);
		});

		it("creates thought chunk when isThought is true", async () => {
			const input = {
				sessionId: "session-123",
				messageId: "msg_thought",
				content: { type: "text" as const, text: "Thinking..." },
				isThought: true,
			};

			const result = await (store as any).createNewAssistantEntry("session-123", input);
			flushBatchedUpdates(); // Flush batched entry additions

			expect(result.isOk()).toBe(true);
			const session = store.getSessionCold("session-123");
			expect(session).toBeDefined();
			const entries = store.getEntries("session-123");
			const chunks = (entries[0].message as any).chunks;
			expect(chunks[0].type).toBe("thought");
		});
	});

	describe("validateChunkInput", () => {
		it("returns ok for valid input", () => {
			const result = (store as any).validateChunkInput(
				"session-123",
				{ content: { type: "text", text: "Hello" } },
				"msg_abc",
				false
			);
			expect(result.isOk()).toBe(true);
		});

		it("returns error for empty sessionId", () => {
			const result = (store as any).validateChunkInput(
				"",
				{ content: { type: "text", text: "Hello" } },
				"msg_abc",
				false
			);
			expect(result.isErr()).toBe(true);
		});
	});

	describe("mergeChunkIntoEntry", () => {
		it("merges chunk into existing entry", async () => {
			// Setup: add initial entry
			const initialInput = {
				sessionId: "session-123",
				messageId: "msg_merge",
				content: { type: "text" as const, text: "First" },
				isThought: false,
			};
			await (store as any).createNewAssistantEntry("session-123", initialInput);
			flushBatchedUpdates(); // Flush to commit initial entry

			// Find the entry
			const entries = store.getEntries("session-123");
			const existing = { entry: entries[0], index: 0 };

			// Merge second chunk
			const mergeInput = {
				sessionId: "session-123",
				messageId: "msg_merge",
				content: { type: "text" as const, text: " Second" },
				isThought: false,
			};
			await (store as any).mergeChunkIntoEntry("session-123", existing, mergeInput);
			flushBatchedUpdates(); // Flush to commit merge

			// Verify
			const updatedEntries = store.getEntries("session-123");
			expect(updatedEntries.length).toBe(1);
			const chunks = (updatedEntries[0].message as any).chunks;
			expect(chunks.length).toBe(2);
			expect(chunks[0].block.text).toBe("First");
			expect(chunks[1].block.text).toBe(" Second");
		});
	});

	describe("aggregateAssistantChunk", () => {
		it("creates new entry for first chunk", async () => {
			const chunk = { content: { type: "text" as const, text: "Hello" } };

			await (store as any).aggregateAssistantChunk("session-123", chunk, "msg_new", false);
			flushBatchedUpdates(); // Flush to commit entry

			const entries = store.getEntries("session-123");
			expect(entries.length).toBe(1);
			expect(entries[0].id).toBe("msg_new");
		});

		it("merges chunk into existing entry with same messageId", async () => {
			const chunk1 = { content: { type: "text" as const, text: "First" } };
			const chunk2 = { content: { type: "text" as const, text: " Second" } };

			await (store as any).aggregateAssistantChunk("session-123", chunk1, "msg_same", false);
			flushBatchedUpdates(); // Flush first chunk
			await (store as any).aggregateAssistantChunk("session-123", chunk2, "msg_same", false);
			flushBatchedUpdates(); // Flush second chunk

			const entries = store.getEntries("session-123");
			expect(entries.length).toBe(1);
			const chunks = (entries[0].message as any).chunks;
			expect(chunks.length).toBe(2);
		});

		it("creates new entry for chunk without messageId", async () => {
			const chunk = { content: { type: "text" as const, text: "No ID" } };

			await (store as any).aggregateAssistantChunk("session-123", chunk, undefined, false);
			flushBatchedUpdates(); // Flush to commit entry

			const entries = store.getEntries("session-123");
			expect(entries.length).toBe(1);
			expect(entries[0].id).toBeDefined();
		});
	});
});
