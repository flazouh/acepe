import { describe, expect, it } from "bun:test";

import {
	createAssistantEntry,
	createToolCallEntry,
	createUserEntry,
} from "../../../components/agent-panel/logic/__tests__/session-entry-factories.js";
import { EntryIndexManager } from "../entry-index-manager.js";

describe("EntryIndexManager", () => {
	describe("entryId index", () => {
		it("adds and retrieves an entry id index", () => {
			const manager = new EntryIndexManager();
			manager.addEntryId("s1", "entry-1", 3);
			expect(manager.getEntryIdIndex("s1", "entry-1")).toBe(3);
		});

		it("rebuilds entry id index from entries", () => {
			const manager = new EntryIndexManager();
			const entries = [
				createUserEntry("user-1"),
				createAssistantEntry("asst-1"),
				createToolCallEntry("tc-1"),
			];

			manager.rebuildEntryIdIndex("s1", entries);

			expect(manager.getEntryIdIndex("s1", "user-1")).toBe(0);
			expect(manager.getEntryIdIndex("s1", "asst-1")).toBe(1);
			expect(manager.getEntryIdIndex("s1", "tc-1")).toBe(2);
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
			manager.addEntryId("s1", "entry-1", 0);
			manager.addToolCallId("s1", "tc-1", 1);

			manager.clearSession("s1");

			expect(manager.getEntryIdIndex("s1", "entry-1")).toBeUndefined();
			expect(manager.getToolCallIdIndex("s1", "tc-1")).toBeUndefined();
		});

		it("does not affect other sessions", () => {
			const manager = new EntryIndexManager();
			manager.addEntryId("s1", "entry-1", 0);
			manager.addEntryId("s2", "entry-2", 1);

			manager.clearSession("s1");

			expect(manager.getEntryIdIndex("s1", "entry-1")).toBeUndefined();
			expect(manager.getEntryIdIndex("s2", "entry-2")).toBe(1);
		});

		it("is safe on unknown session", () => {
			const manager = new EntryIndexManager();
			// Should not throw
			manager.clearSession("unknown");
		});
	});
});
