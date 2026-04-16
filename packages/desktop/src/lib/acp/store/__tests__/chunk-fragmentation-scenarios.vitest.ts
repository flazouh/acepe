/**
 * Chunk Fragmentation Scenarios
 *
 * Targeted tests for the fragmented messages bug: assistant text renders
 * as separate entries instead of one cohesive message.
 *
 * These tests verify chunk merging correctness:
 * - Sequential chunks with the same messageId merge into one entry
 * - undefined messageId with tracker fallback
 * - Tool call boundaries creating correct entry splits
 * - Multiple sequential chunks during a single logical message
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger to avoid console noise
vi.mock("../../utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import type { ToolCallData } from "../../../services/converted-session-types.js";

import { SessionEntryStore } from "../session-entry-store.svelte.js";

/** Helper to create minimal valid ToolCallData */
function toolCall(id: string): ToolCallData {
	return {
		id,
		name: "Run",
		arguments: { kind: "execute", command: "ls" },
		status: "completed",
		kind: "execute",
		title: null,
		locations: null,
		skillMeta: null,
		result: null,
		awaitingPlanApproval: false,
	};
}

/** Helper to send a text chunk */
async function sendChunk(
	store: SessionEntryStore,
	sessionId: string,
	text: string,
	messageId?: string,
	isThought = false
): Promise<void> {
	const result = await store.aggregateAssistantChunk(
		sessionId,
		{ content: { type: "text", text } },
		messageId,
		isThought
	);
	if (result.isErr()) {
		throw new Error(`aggregateAssistantChunk failed: ${result.error.message}`);
	}
}

function countAssistantEntries(store: SessionEntryStore, sessionId: string): number {
	return store.getEntries(sessionId).filter((e) => e.type === "assistant").length;
}

describe("Chunk Fragmentation — sequential chunks", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
		store.storeEntriesAndBuildIndex("s1", []);
	});

	it("merges sequential chunks with the same messageId", async () => {
		await sendChunk(store, "s1", "Hello ", "msg-1");
		await sendChunk(store, "s1", "world", "msg-1");

		expect(countAssistantEntries(store, "s1")).toBe(1);
		const entry = store.getEntries("s1")[0];
		if (entry.type === "assistant") {
			expect(entry.message.chunks).toHaveLength(2);
		}
	});

	it("merges multiple sequential chunks", async () => {
		await sendChunk(store, "s1", "A", "msg-1");
		await sendChunk(store, "s1", "B", "msg-1");
		await sendChunk(store, "s1", "C", "msg-1");
		await sendChunk(store, "s1", "D", "msg-1");

		expect(countAssistantEntries(store, "s1")).toBe(1);
		const entry = store.getEntries("s1")[0];
		if (entry.type === "assistant") {
			expect(entry.message.chunks).toHaveLength(4);
		}
	});

	it("merges many sequential chunks into a single entry", async () => {
		for (let i = 0; i < 10; i++) {
			await sendChunk(store, "s1", `chunk-${i} `, "msg-1");
		}

		expect(countAssistantEntries(store, "s1")).toBe(1);
		const entry = store.getEntries("s1")[0];
		if (entry.type === "assistant") {
			expect(entry.message.chunks).toHaveLength(10);
		}
	});
});

describe("Chunk Fragmentation — undefined messageId with tracker fallback", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
		store.storeEntriesAndBuildIndex("s1", []);
	});

	it("merges chunks when all have undefined messageId (tracker fallback)", async () => {
		// First chunk with undefined messageId: creates entry, tracker stores the generated UUID
		await sendChunk(store, "s1", "Hello ", undefined);
		// Second chunk with undefined messageId: tracker resolves to the UUID from first chunk
		await sendChunk(store, "s1", "world", undefined);

		expect(countAssistantEntries(store, "s1")).toBe(1);
	});

	it("merges sequential undefined-messageId chunks", async () => {
		await sendChunk(store, "s1", "Hello ", undefined);
		await sendChunk(store, "s1", "world", undefined);

		expect(countAssistantEntries(store, "s1")).toBe(1);
	});

	it("merges when first chunk has messageId, subsequent have undefined", async () => {
		// First chunk sets the messageId in the tracker
		await sendChunk(store, "s1", "Start ", "msg-1");
		// Subsequent chunks have no messageId — tracker should resolve to msg-1
		await sendChunk(store, "s1", "middle ", undefined);
		await sendChunk(store, "s1", "end", undefined);

		expect(countAssistantEntries(store, "s1")).toBe(1);
	});

	it("merges when first chunk has messageId then undefined chunks follow", async () => {
		await sendChunk(store, "s1", "Start ", "msg-1");
		await sendChunk(store, "s1", "middle ", undefined);
		await sendChunk(store, "s1", "end", undefined);

		expect(countAssistantEntries(store, "s1")).toBe(1);
	});
});

describe("Chunk Fragmentation — tool call boundary interactions", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
		store.storeEntriesAndBuildIndex("s1", []);
	});

	it("creates new entry after tool call boundary", async () => {
		await sendChunk(store, "s1", "Thinking...", "msg-1", true);
		store.createToolCallEntry("s1", toolCall("tool-1"));
		await sendChunk(store, "s1", "Result: ", "msg-1");
		await sendChunk(store, "s1", "done", "msg-1");

		const entries = store.getEntries("s1");
		expect(entries).toHaveLength(3); // assistant, tool_call, assistant
		expect(entries[0].type).toBe("assistant");
		expect(entries[1].type).toBe("tool_call");
		expect(entries[2].type).toBe("assistant");

		// Post-tool chunks merged into ONE entry
		if (entries[2].type === "assistant") {
			expect(entries[2].message.chunks).toHaveLength(2);
		}
	});

	it("creates new entry after tool call boundary with post-tool chunks", async () => {
		await sendChunk(store, "s1", "Thinking...", "msg-1", true);
		store.createToolCallEntry("s1", toolCall("tool-1"));

		// Post-tool chunks arrive after boundary
		await sendChunk(store, "s1", "Result: ", "msg-1");
		await sendChunk(store, "s1", "done", "msg-1");

		const entries = store.getEntries("s1");
		expect(entries).toHaveLength(3);
		expect(entries[0].type).toBe("assistant");
		expect(entries[1].type).toBe("tool_call");
		expect(entries[2].type).toBe("assistant");

		if (entries[2].type === "assistant") {
			expect(entries[2].message.chunks).toHaveLength(2);
		}
	});

	it("merges post-tool chunks in a tool boundary sequence", async () => {
		await sendChunk(store, "s1", "Think", "msg-1", true);
		store.createToolCallEntry("s1", toolCall("tool-1"));
		await sendChunk(store, "s1", "Part 1 ", "msg-1");
		await sendChunk(store, "s1", "Part 2", "msg-1");

		const entries = store.getEntries("s1");
		expect(entries).toHaveLength(3);

		// Post-tool chunks should still be ONE entry
		if (entries[2].type === "assistant") {
			expect(entries[2].message.chunks).toHaveLength(2);
		}
	});

	it("handles multiple tool calls creating correct entry boundaries", async () => {
		// Phase 1: thought
		await sendChunk(store, "s1", "Let me check...", "msg-1", true);

		// Tool 1
		store.createToolCallEntry("s1", toolCall("tool-1"));

		// Phase 2: response after tool 1
		await sendChunk(store, "s1", "Found it. ", "msg-1");

		// Tool 2
		store.createToolCallEntry("s1", toolCall("tool-2"));

		// Phase 3: response after tool 2
		await sendChunk(store, "s1", "Updated.", "msg-1");

		const entries = store.getEntries("s1");
		// Expected: assistant(thought), tool-1, assistant(response1), tool-2, assistant(response2)
		expect(entries).toHaveLength(5);
		expect(entries.map((e) => e.type)).toEqual([
			"assistant",
			"tool_call",
			"assistant",
			"tool_call",
			"assistant",
		]);
	});

	it("handles undefined messageId after tool call boundary", async () => {
		await sendChunk(store, "s1", "Thinking...", "msg-1", true);
		store.createToolCallEntry("s1", toolCall("tool-1"));

		// Post-tool chunks with NO messageId — boundary cleared the tracker
		// First chunk creates new entry, tracker stores its UUID
		await sendChunk(store, "s1", "Result: ", undefined);

		// Second chunk should merge via tracker fallback to UUID
		await sendChunk(store, "s1", "done", undefined);

		const entries = store.getEntries("s1");
		expect(entries).toHaveLength(3); // assistant, tool_call, assistant

		// Post-tool chunks should be ONE entry
		if (entries[2].type === "assistant") {
			expect(entries[2].message.chunks).toHaveLength(2);
		}
	});
});

describe("Chunk Fragmentation — updateToolCallEntry boundary", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
		store.storeEntriesAndBuildIndex("s1", []);
	});

	it("does not split boundary when updating an existing tool call", async () => {
		await sendChunk(store, "s1", "Before tool", "msg-1");

		store.createToolCallEntry("s1", toolCall("tool-1"));

		store.updateToolCallEntry("s1", {
			toolCallId: "tool-1",
			status: "completed",
		});

		await sendChunk(store, "s1", "After tool", "msg-1");

		const assistantEntries = store.getEntries("s1").filter((e) => e.type === "assistant");
		// Only the initial createToolCallEntry boundary should split.
		expect(assistantEntries).toHaveLength(2);
	});

	it("does not split boundary when a missing-tool update is discarded", async () => {
		await sendChunk(store, "s1", "Before tool", "msg-1");

		// No preceding createToolCallEntry; update-only path is discarded.
		store.updateToolCallEntry("s1", {
			toolCallId: "tool-2",
			status: "completed",
		});

		await sendChunk(store, "s1", "After tool", "msg-1");

		const assistantEntries = store.getEntries("s1").filter((e) => e.type === "assistant");
		expect(assistantEntries).toHaveLength(1);
	});
});

describe("Chunk Fragmentation — user message boundary", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
		store.storeEntriesAndBuildIndex("s1", []);
	});

	it("clearStreamingAssistantEntry clears tracker but same messageId still merges via index", async () => {
		await sendChunk(store, "s1", "First response", "msg-1");

		// clearStreamingAssistantEntry resets tracker and boundaries
		// but does NOT remove from messageIdIndex, so same messageId still merges
		store.clearStreamingAssistantEntry("s1");

		await sendChunk(store, "s1", "Second response", "msg-1");

		const assistantEntries = store.getEntries("s1").filter((e) => e.type === "assistant");
		// Same messageId still found via messageIdIndex — merges into existing entry
		expect(assistantEntries).toHaveLength(1);
	});

	it("clearStreamingAssistantEntry forces new entry when subsequent chunks have undefined messageId", async () => {
		await sendChunk(store, "s1", "First response", "msg-1");

		// Clear tracker — now undefined-messageId chunks can't fall back to msg-1
		store.clearStreamingAssistantEntry("s1");

		// Chunk with undefined messageId: tracker returns null, creates new entry
		await sendChunk(store, "s1", "Second response", undefined);

		const assistantEntries = store.getEntries("s1").filter((e) => e.type === "assistant");
		expect(assistantEntries).toHaveLength(2);
	});
});
