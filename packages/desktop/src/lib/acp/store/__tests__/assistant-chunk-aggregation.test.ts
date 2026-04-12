/**
 * Assistant Chunk Aggregation — Text Duplication Bug Tests
 *
 * Integration tests verifying that assistant message text chunks produce
 * correct text through the full pipeline: store → grouping → rendered text.
 *
 * Bug: assistant message text appears doubled/interleaved in the UI.
 * Example: "Done.Done. Removed the test section from Removed the test section from CLAUDE.md. CLAUDE.md."
 *
 * Finding: Store layer is correct (confirmed by chunk-aggregation-bug.test.ts
 * and chunk-fragmentation-scenarios.vitest.ts). These tests verify the full
 * pipeline including groupAssistantChunks to isolate store vs rendering bugs.
 */

import { describe, expect, it } from "bun:test";
import { groupAssistantChunks } from "../../logic/assistant-chunk-grouper.js";
import type { AssistantMessage } from "../../types/assistant-message.js";
import { SessionEntryStore } from "../session-entry-store.svelte.js";

// ==========================================
// Helpers
// ==========================================

function initStore(): SessionEntryStore {
	const store = new SessionEntryStore();
	store.storeEntriesAndBuildIndex("sess-1", []);
	return store;
}

function getAssistantTextContent(store: SessionEntryStore, sessionId: string): string {
	const entries = store.getEntries(sessionId);
	const assistantEntries = entries.filter((e) => e.type === "assistant");

	return assistantEntries
		.map((e) => {
			const msg = e.message as AssistantMessage;
			const grouped = groupAssistantChunks(msg.chunks);
			return grouped.messageGroups
				.filter((g) => g.type === "text")
				.map((g) => g.text)
				.join("");
		})
		.join("");
}

// ==========================================
// Tests
// ==========================================

describe("Assistant chunk aggregation — text duplication bug", () => {
	describe("Claude Code scenario: incremental text", () => {
		it("accumulates incremental text chunks without duplication", async () => {
			const store = initStore();

			await store.aggregateAssistantChunk(
				"sess-1",
				{ content: { type: "text", text: "Done. " } },
				"msg-1",
				false
			);
			await store.aggregateAssistantChunk(
				"sess-1",
				{ content: { type: "text", text: "Removed " } },
				"msg-1",
				false
			);
			await store.aggregateAssistantChunk(
				"sess-1",
				{ content: { type: "text", text: "the test section " } },
				"msg-1",
				false
			);
			await store.aggregateAssistantChunk(
				"sess-1",
				{ content: { type: "text", text: "from CLAUDE.md." } },
				"msg-1",
				false
			);

			const entries = store.getEntries("sess-1");
			expect(entries.length).toBe(1);

			const msg = entries[0].message as AssistantMessage;
			expect(msg.chunks.length).toBe(4);
			expect(msg.chunks[0].block).toEqual({ type: "text", text: "Done. " });
			expect(msg.chunks[1].block).toEqual({ type: "text", text: "Removed " });
			expect(msg.chunks[2].block).toEqual({ type: "text", text: "the test section " });
			expect(msg.chunks[3].block).toEqual({ type: "text", text: "from CLAUDE.md." });

			const text = getAssistantTextContent(store, "sess-1");
			expect(text).toBe("Done. Removed the test section from CLAUDE.md.");
		});

		it("does NOT produce interleaved duplication pattern", async () => {
			const store = initStore();

			for (const text of ["Done.", " Removed the test section from ", "CLAUDE.md."]) {
				await store.aggregateAssistantChunk(
					"sess-1",
					{ content: { type: "text", text } },
					"msg-1",
					false
				);
			}

			const text = getAssistantTextContent(store, "sess-1");
			expect(text).toBe("Done. Removed the test section from CLAUDE.md.");
			expect(text).not.toContain("Done.Done.");
		});
	});

	describe("Post-tool-call text (exact bug report scenario)", () => {
		it("post-edit text is not duplicated", async () => {
			const store = initStore();

			// Pre-edit thought
			await store.aggregateAssistantChunk(
				"sess-1",
				{ content: { type: "text", text: "I'll remove that section." } },
				"msg-1",
				true
			);

			// Tool call boundary
			store.createToolCallEntry("sess-1", {
				id: "tool-edit-1",
				name: "Edit",
				arguments: {
					kind: "edit",
					edits: [{ type: "replaceText", file_path: "/CLAUDE.md", old_text: "## Test", new_text: null }],
				},
				status: "completed",
				kind: "edit",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});

			// Post-edit response (this is the text that gets doubled in the bug)
			for (const text of ["Done.", " Removed the test section from ", "CLAUDE.md."]) {
				await store.aggregateAssistantChunk(
					"sess-1",
					{ content: { type: "text", text } },
					"msg-1",
					false
				);
			}

			const entries = store.getEntries("sess-1");
			expect(entries.length).toBe(3);
			expect(entries[0].type).toBe("assistant");
			expect(entries[1].type).toBe("tool_call");
			expect(entries[2].type).toBe("assistant");

			// Post-edit text should NOT be duplicated
			const postEditMsg = entries[2].message as AssistantMessage;
			const grouped = groupAssistantChunks(postEditMsg.chunks);
			const text = grouped.messageGroups
				.filter((g) => g.type === "text")
				.map((g) => g.text)
				.join("");

			expect(text).toBe("Done. Removed the test section from CLAUDE.md.");
			expect(text).not.toContain("Done.Done.");
			expect(text).not.toContain("Removed the test section from Removed");
		});
	});

	describe("groupAssistantChunks correctness", () => {
		it("concatenates consecutive text chunks without duplication", () => {
			const chunks = [
				{ type: "message" as const, block: { type: "text" as const, text: "Done. " } },
				{ type: "message" as const, block: { type: "text" as const, text: "Removed " } },
				{ type: "message" as const, block: { type: "text" as const, text: "the test section " } },
				{ type: "message" as const, block: { type: "text" as const, text: "from CLAUDE.md." } },
			];

			const grouped = groupAssistantChunks(chunks);
			expect(grouped.messageGroups.length).toBe(1);
			if (grouped.messageGroups[0].type === "text") {
				expect(grouped.messageGroups[0].text).toBe(
					"Done. Removed the test section from CLAUDE.md."
				);
			}
		});
	});
});
