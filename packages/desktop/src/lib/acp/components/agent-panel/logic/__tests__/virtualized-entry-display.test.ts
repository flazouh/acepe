import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../../application/dto/session.js";

import {
	buildVirtualizedDisplayEntries,
	getLatestRevealTargetKey,
	getVirtualizedDisplayEntryKey,
	isMergedThoughtAssistantDisplayEntry,
	THINKING_DISPLAY_ENTRY,
} from "../virtualized-entry-display.js";

function createThoughtAssistantEntry(id: string, text: string): SessionEntry {
	return {
		id,
		type: "assistant",
		message: {
			chunks: [{ type: "thought", block: { type: "text", text } }],
		},
		timestamp: new Date(),
	};
}

function createMessageAssistantEntry(id: string, text: string): SessionEntry {
	return {
		id,
		type: "assistant",
		message: {
			chunks: [{ type: "message", block: { type: "text", text } }],
		},
		timestamp: new Date(),
	};
}

describe("virtualized-entry-display", () => {
	it("keeps a stable key when appending another thought-only assistant entry to a merged group", () => {
		const first = createThoughtAssistantEntry("a1", "thinking one");
		const second = createThoughtAssistantEntry("a2", "thinking two");

		const initial = buildVirtualizedDisplayEntries([first]);
		const afterAppend = buildVirtualizedDisplayEntries([first, second]);

		expect(initial).toHaveLength(1);
		expect(afterAppend).toHaveLength(1);
		expect(getVirtualizedDisplayEntryKey(initial[0]!)).toBe("a1");
		expect(getVirtualizedDisplayEntryKey(afterAppend[0]!)).toBe("a1");
	});

	it("tracks memberIds so streaming can match later merged entries", () => {
		const merged = buildVirtualizedDisplayEntries([
			createThoughtAssistantEntry("a1", "thinking one"),
			createThoughtAssistantEntry("a2", "thinking two"),
		])[0];

		expect(merged).toBeDefined();
		expect(isMergedThoughtAssistantDisplayEntry(merged!)).toBe(true);
		if (!isMergedThoughtAssistantDisplayEntry(merged!)) {
			throw new Error("expected merged thought display entry");
		}
		expect(merged.memberIds).toEqual(["a1", "a2"]);
	});

	it("does not reuse merged key for a following non-thought assistant message", () => {
		const display = buildVirtualizedDisplayEntries([
			createThoughtAssistantEntry("a1", "thinking one"),
			createThoughtAssistantEntry("a2", "thinking two"),
			createMessageAssistantEntry("a3", "final answer"),
		]);

		expect(display).toHaveLength(2);
		expect(getVirtualizedDisplayEntryKey(display[0]!)).toBe("a1");
		expect(getVirtualizedDisplayEntryKey(display[1]!)).toBe("a3");
		expect(isMergedThoughtAssistantDisplayEntry(display[1]!)).toBe(false);
	});

	it("uses the newest non-thinking entry as the reveal target when waiting trails the thread", () => {
		const display = buildVirtualizedDisplayEntries([
			createMessageAssistantEntry("assistant-1", "latest reply"),
		]);
		display.push(THINKING_DISPLAY_ENTRY);

		expect(getLatestRevealTargetKey(display)).toBe("assistant-1");
	});
});
