import { describe, expect, it } from "bun:test";

import {
	createAssistantEntry,
	createToolCallEntry,
	createUserEntry,
} from "../../../components/agent-panel/logic/__tests__/session-entry-factories.js";
import { EntryIndexManager } from "../entry-index-manager.js";

describe("EntryIndexManager", () => {
	// ============================================
	// MESSAGE ID INDEX
	// ============================================

	describe("messageId index", () => {
		it("returns undefined for unknown session", () => {
			const manager = new EntryIndexManager();
			expect(manager.getMessageIdIndex("unknown", "msg-1")).toBeUndefined();
		});

		it("returns undefined for unknown messageId", () => {
			const manager = new EntryIndexManager();
			manager.addMessageId("s1", "msg-1", 0);
			expect(manager.getMessageIdIndex("s1", "msg-unknown")).toBeUndefined();
		});

		it("adds and retrieves a messageId index", () => {
			const manager = new EntryIndexManager();
			manager.addMessageId("s1", "msg-1", 3);
			expect(manager.getMessageIdIndex("s1", "msg-1")).toBe(3);
		});

		it("overwrites existing messageId index", () => {
			const manager = new EntryIndexManager();
			manager.addMessageId("s1", "msg-1", 3);
			manager.addMessageId("s1", "msg-1", 7);
			expect(manager.getMessageIdIndex("s1", "msg-1")).toBe(7);
		});

		it("isolates indices per session", () => {
			const manager = new EntryIndexManager();
			manager.addMessageId("s1", "msg-1", 0);
			manager.addMessageId("s2", "msg-1", 5);
			expect(manager.getMessageIdIndex("s1", "msg-1")).toBe(0);
			expect(manager.getMessageIdIndex("s2", "msg-1")).toBe(5);
		});

		it("deletes a messageId from index", () => {
			const manager = new EntryIndexManager();
			manager.addMessageId("s1", "msg-1", 0);
			manager.addMessageId("s1", "msg-2", 1);
			manager.deleteMessageId("s1", "msg-1");
			expect(manager.getMessageIdIndex("s1", "msg-1")).toBeUndefined();
			expect(manager.getMessageIdIndex("s1", "msg-2")).toBe(1);
		});

		it("deleteMessageId is safe on unknown session", () => {
			const manager = new EntryIndexManager();
			// Should not throw
			manager.deleteMessageId("unknown", "msg-1");
		});

		it("rebuilds messageId index from entries", () => {
			const manager = new EntryIndexManager();
			const entries = [
				createUserEntry("user-1"),
				createAssistantEntry("asst-1"),
				createToolCallEntry("tc-1"),
				createAssistantEntry("asst-2"),
			];

			manager.rebuildMessageIdIndex("s1", entries);

			expect(manager.getMessageIdIndex("s1", "asst-1")).toBe(1);
			expect(manager.getMessageIdIndex("s1", "asst-2")).toBe(3);
			// Non-assistant entries should not be indexed
			expect(manager.getMessageIdIndex("s1", "user-1")).toBeUndefined();
			expect(manager.getMessageIdIndex("s1", "tc-1")).toBeUndefined();
		});

		it("rebuild replaces existing index", () => {
			const manager = new EntryIndexManager();
			manager.addMessageId("s1", "old-msg", 99);

			manager.rebuildMessageIdIndex("s1", [createAssistantEntry("new-msg")]);

			expect(manager.getMessageIdIndex("s1", "old-msg")).toBeUndefined();
			expect(manager.getMessageIdIndex("s1", "new-msg")).toBe(0);
		});
	});

	// ============================================
	// TOOL CALL ID INDEX
	// ============================================

	describe("toolCallId index", () => {
		it("returns undefined for unknown session", () => {
			const manager = new EntryIndexManager();
			expect(manager.getToolCallIdIndex("unknown", "tc-1")).toBeUndefined();
		});

		it("adds and retrieves a toolCallId index", () => {
			const manager = new EntryIndexManager();
			manager.addToolCallId("s1", "tc-1", 2);
			expect(manager.getToolCallIdIndex("s1", "tc-1")).toBe(2);
		});

		it("isolates indices per session", () => {
			const manager = new EntryIndexManager();
			manager.addToolCallId("s1", "tc-1", 0);
			manager.addToolCallId("s2", "tc-1", 4);
			expect(manager.getToolCallIdIndex("s1", "tc-1")).toBe(0);
			expect(manager.getToolCallIdIndex("s2", "tc-1")).toBe(4);
		});

		it("rebuilds toolCallId index from entries", () => {
			const manager = new EntryIndexManager();
			const entries = [
				createUserEntry("user-1"),
				createToolCallEntry("tc-1"),
				createAssistantEntry("asst-1"),
				createToolCallEntry("tc-2"),
			];

			manager.rebuildToolCallIdIndex("s1", entries);

			expect(manager.getToolCallIdIndex("s1", "tc-1")).toBe(1);
			expect(manager.getToolCallIdIndex("s1", "tc-2")).toBe(3);
			// Non-tool-call entries should not be indexed
			expect(manager.getToolCallIdIndex("s1", "user-1")).toBeUndefined();
			expect(manager.getToolCallIdIndex("s1", "asst-1")).toBeUndefined();
		});

		it("rebuild replaces existing index", () => {
			const manager = new EntryIndexManager();
			manager.addToolCallId("s1", "old-tc", 99);

			manager.rebuildToolCallIdIndex("s1", [createToolCallEntry("new-tc")]);

			expect(manager.getToolCallIdIndex("s1", "old-tc")).toBeUndefined();
			expect(manager.getToolCallIdIndex("s1", "new-tc")).toBe(0);
		});
	});

	// ============================================
	// SESSION CLEANUP
	// ============================================

	describe("clearSession", () => {
		it("clears all indices for a session", () => {
			const manager = new EntryIndexManager();
			manager.addMessageId("s1", "msg-1", 0);
			manager.addToolCallId("s1", "tc-1", 1);

			manager.clearSession("s1");

			expect(manager.getMessageIdIndex("s1", "msg-1")).toBeUndefined();
			expect(manager.getToolCallIdIndex("s1", "tc-1")).toBeUndefined();
		});

		it("does not affect other sessions", () => {
			const manager = new EntryIndexManager();
			manager.addMessageId("s1", "msg-1", 0);
			manager.addMessageId("s2", "msg-2", 1);

			manager.clearSession("s1");

			expect(manager.getMessageIdIndex("s1", "msg-1")).toBeUndefined();
			expect(manager.getMessageIdIndex("s2", "msg-2")).toBe(1);
		});

		it("is safe on unknown session", () => {
			const manager = new EntryIndexManager();
			// Should not throw
			manager.clearSession("unknown");
		});
	});
});
