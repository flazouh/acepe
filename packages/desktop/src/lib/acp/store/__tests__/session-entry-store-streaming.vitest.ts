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

import { SessionEntryStore } from "../session-entry-store.svelte.js";

describe("SessionEntryStore - Streaming Arguments", () => {
	let store: SessionEntryStore;

	beforeEach(() => {
		store = new SessionEntryStore();
	});

	describe("setStreamingArguments / getStreamingArguments", () => {
		it("should store and retrieve streaming arguments", () => {
			store.setStreamingArguments("session1", "tool1", {
				kind: "edit",
				edits: [{ filePath: "/path/to/file.ts", oldString: null, newString: "content", content: null }],
			});

			const result = store.getStreamingArguments("tool1");
			expect(result).toEqual({
				kind: "edit",
				edits: [{ filePath: "/path/to/file.ts", oldString: null, newString: "content", content: null }],
			});
		});

		it("should track tool calls per session", () => {
			store.setStreamingArguments("session1", "tool1", { kind: "execute", command: "ls -la" });
			store.setStreamingArguments("session1", "tool2", { kind: "search", query: "test" });
			store.setStreamingArguments("session2", "tool3", { kind: "read", file_path: "/tmp/file" });

			expect(store.getStreamingArguments("tool1")).toEqual({ kind: "execute", command: "ls -la" });
			expect(store.getStreamingArguments("tool2")).toEqual({ kind: "search", query: "test" });
			expect(store.getStreamingArguments("tool3")).toEqual({
				kind: "read",
				file_path: "/tmp/file",
			});
		});

		it("should overwrite when setting same tool call again", () => {
			store.setStreamingArguments("session1", "tool1", {
				kind: "edit",
				edits: [{ filePath: "/a", oldString: null, newString: "v1", content: null }],
			});
			store.setStreamingArguments("session1", "tool1", {
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
			store.setStreamingArguments("session1", "tool1", {
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
			store.setStreamingArguments("session1", "tool1", { kind: "execute", command: "a" });
			store.setStreamingArguments("session1", "tool2", { kind: "execute", command: "b" });
			store.setStreamingArguments("session2", "tool3", { kind: "execute", command: "c" });

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
