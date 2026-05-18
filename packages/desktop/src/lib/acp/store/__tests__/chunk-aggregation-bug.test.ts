/**
 * Regression test for the chunk aggregation bug:
 * Rapid streaming chunks with the same messageId were creating SEPARATE
 * assistant entries instead of merging into ONE entry, causing fragmented
 * text display in the UI (colons, partial words on separate lines).
 *
 * Root cause: When multiple chunks arrive before the RAF batch flush,
 * the first chunk creates a new pending entry, but subsequent chunks
 * fail to find it and create additional entries instead.
 */
import { beforeEach, describe, expect, it } from "bun:test";

import { SessionEntryStore } from "../session-entry-store.svelte.js";
import {
	aggregateCompatibilityAssistantChunk,
	preloadCompatibilityEntriesAndBuildIndex,
	readCompatibilityEntries,
	recordCompatibilityToolCallTranscriptEntry,
} from "./entry-store-test-access.js";

describe("Chunk Aggregation Bug - Rapid streaming chunks create separate entries", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
		preloadCompatibilityEntriesAndBuildIndex(store, "session1", []);
	});

	it("should merge all chunks with same messageId into one assistant entry (before flush)", async () => {
		// Simulate rapid streaming - many small chunks arriving quickly with the same messageId
		// Before the RAF flush, all chunks should be merged into one pending entry
		const messageId = "msg-streaming-test";

		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "The " } },
			messageId,
			false
		);
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "quick " } },
			messageId,
			false
		);
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "brown " } },
			messageId,
			false
		);
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "fox" } },
			messageId,
			false
		);

		// Compatibility rows are synchronous, so we can check before any flush.
		const entries = readCompatibilityEntries(store, "session1");

		// BUG: This currently creates multiple entries instead of 1
		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe("assistant");
		expect(entries[0].id).toBe(messageId);

		if (entries[0].type === "assistant") {
			expect(entries[0].message.chunks).toHaveLength(4);
			expect(entries[0].message.chunks[0].block).toEqual({ type: "text", text: "The " });
			expect(entries[0].message.chunks[1].block).toEqual({ type: "text", text: "quick " });
			expect(entries[0].message.chunks[2].block).toEqual({ type: "text", text: "brown " });
			expect(entries[0].message.chunks[3].block).toEqual({ type: "text", text: "fox" });
		}
	});

	it("should merge chunks that arrive between tool calls into separate entries per phase", async () => {
		const messageId = "msg-with-tool";

		// Phase 1: pre-tool thought
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "Let me " } },
			messageId,
			true
		);
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "check this." } },
			messageId,
			true
		);

		// Tool call creates a boundary
		recordCompatibilityToolCallTranscriptEntry(store, "session1", {
			id: "tool-1",
			name: "Run",
			arguments: { kind: "execute", command: "ls" },
			status: "completed",
			kind: "execute",
			title: null,
			locations: null,
			skillMeta: null,
			result: null,
			awaitingPlanApproval: false,
		});

		// Phase 2: post-tool response - same messageId, should create NEW entry
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "Here " } },
			messageId,
			false
		);
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "are the " } },
			messageId,
			false
		);
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "results." } },
			messageId,
			false
		);

		const entries = readCompatibilityEntries(store, "session1");

		// Should be: [assistant(thought), tool_call, assistant(message)]
		expect(entries).toHaveLength(3);
		expect(entries[0].type).toBe("assistant");
		expect(entries[1].type).toBe("tool_call");
		expect(entries[2].type).toBe("assistant");

		// Post-tool chunks should all be in ONE entry, not 3 separate entries
		if (entries[2].type === "assistant") {
			expect(entries[2].message.chunks).toHaveLength(3);
			expect(entries[2].message.chunks[0].block).toEqual({ type: "text", text: "Here " });
			expect(entries[2].message.chunks[1].block).toEqual({ type: "text", text: "are the " });
			expect(entries[2].message.chunks[2].block).toEqual({ type: "text", text: "results." });
		}
	});

	it("should create separate entries for different messageIds", async () => {
		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "Message 1" } },
			"msg-1",
			false
		);

		await aggregateCompatibilityAssistantChunk(store,
			"session1",
			{ content: { type: "text", text: "Message 2" } },
			"msg-2",
			false
		);

		const entries = readCompatibilityEntries(store, "session1");

		// Different messageIds SHOULD create separate entries
		expect(entries).toHaveLength(2);
		expect(entries[0].id).toBe("msg-1");
		expect(entries[1].id).toBe("msg-2");
	});
});
