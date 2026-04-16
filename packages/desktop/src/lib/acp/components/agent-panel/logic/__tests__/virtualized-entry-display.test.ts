import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../../application/dto/session.js";

import {
	buildVirtualizedDisplayEntries,
	getLatestRevealTargetKey,
	getVirtualizedDisplayEntryKey,
	isMergedThoughtAssistantDisplayEntry,
	resolveDisplayEntryThinkingDurationMs,
	shouldObserveRevealResize,
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
		const initialEntry = initial.at(0);
		const appendedEntry = afterAppend.at(0);

		expect(initial).toHaveLength(1);
		expect(afterAppend).toHaveLength(1);
		expect(initialEntry).toBeDefined();
		expect(appendedEntry).toBeDefined();
		if (!initialEntry || !appendedEntry) {
			throw new Error("expected merged entries to exist");
		}
		expect(getVirtualizedDisplayEntryKey(initialEntry)).toBe("a1");
		expect(getVirtualizedDisplayEntryKey(appendedEntry)).toBe("a1");
	});

	it("tracks memberIds so streaming can match later merged entries", () => {
		const merged = buildVirtualizedDisplayEntries([
			createThoughtAssistantEntry("a1", "thinking one"),
			createThoughtAssistantEntry("a2", "thinking two"),
		])[0];

		expect(merged).toBeDefined();
		if (!merged) {
			throw new Error("expected merged thought display entry");
		}
		expect(isMergedThoughtAssistantDisplayEntry(merged)).toBe(true);
		if (!isMergedThoughtAssistantDisplayEntry(merged)) {
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
		const firstDisplayEntry = display.at(0);
		const secondDisplayEntry = display.at(1);

		expect(display).toHaveLength(2);
		expect(firstDisplayEntry).toBeDefined();
		expect(secondDisplayEntry).toBeDefined();
		if (!firstDisplayEntry || !secondDisplayEntry) {
			throw new Error("expected display entries to exist");
		}
		expect(getVirtualizedDisplayEntryKey(firstDisplayEntry)).toBe("a1");
		expect(getVirtualizedDisplayEntryKey(secondDisplayEntry)).toBe("a3");
		expect(isMergedThoughtAssistantDisplayEntry(secondDisplayEntry)).toBe(false);
	});

	it("uses the thinking indicator as the reveal target when waiting trails the thread", () => {
		const display = buildVirtualizedDisplayEntries([
			createMessageAssistantEntry("assistant-1", "latest reply"),
		]);
		display.push(THINKING_DISPLAY_ENTRY);

		expect(getLatestRevealTargetKey(display)).toBe("thinking-indicator");
	});

	it("keeps observing the latest non-thinking entry for resize while waiting trails the thread", () => {
		const display = buildVirtualizedDisplayEntries([
			createMessageAssistantEntry("assistant-1", "latest reply"),
		]);
		const latestEntry = display.at(0);
		display.push(THINKING_DISPLAY_ENTRY);

		expect(latestEntry).toBeDefined();
		if (!latestEntry) {
			throw new Error("expected latest display entry");
		}
		expect(shouldObserveRevealResize(display, latestEntry, true)).toBe(true);
		expect(shouldObserveRevealResize(display, latestEntry, false)).toBe(true);
		expect(shouldObserveRevealResize(display, THINKING_DISPLAY_ENTRY, true)).toBe(false);
	});

	it("measures merged thought duration until the next timed entry", () => {
		const display = buildVirtualizedDisplayEntries([
			{
				id: "thought-1",
				type: "assistant",
				message: {
					chunks: [{ type: "thought", block: { type: "text", text: "thinking one" } }],
				},
				timestamp: new Date("2026-01-01T00:00:00.000Z"),
			},
			{
				id: "message-1",
				type: "assistant",
				message: {
					chunks: [{ type: "message", block: { type: "text", text: "done" } }],
				},
				timestamp: new Date("2026-01-01T00:00:05.000Z"),
			},
		]);

		expect(resolveDisplayEntryThinkingDurationMs(display, 0, Date.parse("2026-01-01T00:00:08.000Z"))).toBe(
			5_000
		);
	});

	it("keeps live thought durations growing while the trailing thinking indicator is visible", () => {
		const display = buildVirtualizedDisplayEntries([
			{
				id: "thought-1",
				type: "assistant",
				message: {
					chunks: [{ type: "thought", block: { type: "text", text: "thinking one" } }],
				},
				timestamp: new Date("2026-01-01T00:00:00.000Z"),
			},
		]);
		display.push({
			type: "thinking",
			id: "thinking-indicator",
			startedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
		});

		expect(resolveDisplayEntryThinkingDurationMs(display, 0, Date.parse("2026-01-01T00:00:08.000Z"))).toBe(
			8_000
		);
		expect(resolveDisplayEntryThinkingDurationMs(display, 1, Date.parse("2026-01-01T00:00:08.000Z"))).toBe(
			8_000
		);
	});
});
