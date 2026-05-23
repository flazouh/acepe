import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import { createLongSessionFixture } from "../../../../testing/long-session-fixture.js";

import {
	appendVirtualizedDisplayEntriesFromScene,
	buildVirtualizedDisplayEntries,
	buildVirtualizedDisplayEntriesFromScene,
	findLastAssistantSceneIndex,
	getLatestRevealTargetKey,
	getVirtualizedDisplayEntryKey,
	getVirtualizedDisplayEntryTimestampMs,
	isMergedAssistantDisplayEntry,
	resolveDisplayEntryThinkingDurationMs,
	shouldObserveRevealResize,
	THINKING_DISPLAY_ENTRY,
	type VirtualizedDisplayEntry,
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
		expect(isMergedAssistantDisplayEntry(merged)).toBe(true);
		if (!isMergedAssistantDisplayEntry(merged)) {
			throw new Error("expected merged thought display entry");
		}
		expect(merged.memberIds).toEqual(["a1", "a2"]);
	});

	it("merges adjacent assistant thought and message entries into one display entry", () => {
		const display = buildVirtualizedDisplayEntries([
			createThoughtAssistantEntry("a1", "thinking one"),
			createThoughtAssistantEntry("a2", "thinking two"),
			createMessageAssistantEntry("a3", "final answer"),
		]);

		expect(display).toHaveLength(1);
		const merged = display.at(0);
		expect(merged).toBeDefined();
		if (!merged) {
			throw new Error("expected merged display entry");
		}
		expect(getVirtualizedDisplayEntryKey(merged)).toBe("a1");
		expect(isMergedAssistantDisplayEntry(merged)).toBe(true);
		if (!isMergedAssistantDisplayEntry(merged)) {
			throw new Error("expected merged display entry");
		}
		expect(merged.memberIds).toEqual(["a1", "a2", "a3"]);
	});

	it("merges adjacent assistant message entries into one display entry", () => {
		const display = buildVirtualizedDisplayEntries([
			createMessageAssistantEntry("a1", "hello "),
			createMessageAssistantEntry("a2", "world"),
		]);

		expect(display).toHaveLength(1);
		const merged = display.at(0);
		expect(merged).toBeDefined();
		if (!merged) {
			throw new Error("expected merged display entry");
		}
		expect(isMergedAssistantDisplayEntry(merged)).toBe(true);
		if (!isMergedAssistantDisplayEntry(merged)) {
			throw new Error("expected merged display entry");
		}
		expect(merged.memberIds).toEqual(["a1", "a2"]);
		expect(merged.markdown).toBe("hello world");
		expect(
			merged.message.chunks
				.map((chunk) => (chunk.block.type === "text" ? chunk.block.text : ""))
				.join("")
		).toBe("hello world");
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

		expect(
			resolveDisplayEntryThinkingDurationMs(display, 0, Date.parse("2026-01-01T00:00:08.000Z"))
		).toBe(5_000);
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

		expect(
			resolveDisplayEntryThinkingDurationMs(display, 0, Date.parse("2026-01-01T00:00:08.000Z"))
		).toBe(8_000);
		expect(
			resolveDisplayEntryThinkingDurationMs(display, 1, Date.parse("2026-01-01T00:00:08.000Z"))
		).toBe(8_000);
	});

	it("does not amplify display entry count for long-session fixture entries", () => {
		const longFixture = createLongSessionFixture({ scale: "long" });
		const doubledFixture = createLongSessionFixture({ scale: "doubled" });
		const longDisplay = buildVirtualizedDisplayEntries(longFixture.entries);
		const doubledDisplay = buildVirtualizedDisplayEntries(doubledFixture.entries);

		expect(longDisplay.length).toBeLessThanOrEqual(longFixture.entries.length);
		expect(doubledDisplay.length).toBeLessThanOrEqual(doubledFixture.entries.length);
		expect(doubledDisplay.length).toBeLessThanOrEqual(longDisplay.length * 2 + 2);
	});

	it("resolves tail thinking duration without scanning the full long-session display history", () => {
		const fixture = createLongSessionFixture({ scale: "long" });
		const display = buildVirtualizedDisplayEntries(
			fixture.entries.concat([
				{
					id: "tail-thought",
					type: "assistant",
					message: {
						chunks: [{ type: "thought", block: { type: "text", text: "still thinking" } }],
					},
					timestamp: new Date("2026-01-01T00:00:00.000Z"),
				},
			])
		);
		display.push({
			type: "thinking",
			id: "thinking-indicator",
			startedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
		});
		let numericReads = 0;
		const observedDisplay = new Proxy(display, {
			get(target, property, receiver) {
				if (typeof property === "string" && /^[0-9]+$/.test(property)) {
					numericReads += 1;
				}
				return Reflect.get(target, property, receiver);
			},
		}) satisfies VirtualizedDisplayEntry[];

		const duration = resolveDisplayEntryThinkingDurationMs(
			observedDisplay,
			observedDisplay.length - 2,
			Date.parse("2026-01-01T00:00:08.000Z")
		);

		expect(duration).toBe(8_000);
		expect(numericReads).toBeLessThanOrEqual(2);
	});
});

// ===== SCENE-NATIVE PATH TESTS =====

describe("buildVirtualizedDisplayEntriesFromScene", () => {
	it("returns empty array for empty scene", () => {
		expect(buildVirtualizedDisplayEntriesFromScene([])).toEqual([]);
	});

	it("maps a single optimistic user entry to a user SessionEntry", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{
				type: "user",
				id: "u1",
				text: "hello world",
				isOptimistic: true,
			},
		];
		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result).toHaveLength(1);
		const entry = result[0]!;
		expect(entry.type).toBe("user");
		if (entry.type === "user") {
			expect(entry.id).toBe("u1");
			expect(entry.message.content).toEqual({ type: "text", text: "hello world" });
		}
	});

	it("maps a mixed sequence of user/assistant/tool entries correctly", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{ type: "user", id: "u1", text: "prompt", isOptimistic: false },
			{ type: "assistant", id: "a1", markdown: "# Response", isStreaming: false },
			{
				type: "tool_call",
				id: "tc1",
				title: "bash",
				status: "done",
			},
		];

		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result).toHaveLength(3);

		const [user, assistant, tool] = result;
		expect(user!.type).toBe("user");
		expect(assistant!.type).toBe("assistant_merged");
		expect(tool!.type).toBe("tool_call");

		if (assistant!.type === "assistant_merged") {
			expect(assistant.key).toBe("a1");
			expect(assistant.memberIds).toEqual(["a1"]);
			expect(assistant.isStreaming).toBe(false);
		}
		if (tool!.type === "tool_call") {
			expect((tool as { id: string }).id).toBe("tc1");
		}
	});

	it("preserves first-class missing scene entries as display rows", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{
				id: "missing-1",
				type: "missing",
				diagnosticLabel: "scene:missing-1",
			},
		];

		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result).toEqual([
			{
				id: "missing-1",
				type: "missing",
			},
		]);
	});

	it("keeps a streaming assistant row separate from prior static assistant text", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{ type: "assistant", id: "a1", markdown: "first", isStreaming: false },
			{ type: "assistant", id: "a2", markdown: "second", isStreaming: true },
		];

		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			type: "assistant_merged",
			key: "a1",
			memberIds: ["a1"],
			markdown: "first",
			isStreaming: false,
		});
		expect(result[1]).toMatchObject({
			type: "assistant_merged",
			key: "a2",
			memberIds: ["a2"],
			markdown: "second",
			isStreaming: true,
		});
		if (result[0]?.type === "assistant_merged") {
			expect(result[0].message.chunks).toHaveLength(1);
		}
		if (result[1]?.type === "assistant_merged") {
			expect(result[1].message.chunks).toHaveLength(1);
		}
	});

	it("keeps an animating assistant row separate from prior assistant text", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{ type: "assistant", id: "a1", markdown: "first ", isStreaming: false },
			{
				type: "assistant",
				id: "a2",
				markdown: "second answer",
				isStreaming: false,
				tokenRevealCss: {
					revealCount: 2,
					revealedCharCount: "second answer".length,
					baselineMs: -32,
					tokStepMs: 32,
					tokFadeDurMs: 420,
					mode: "smooth",
				},
			},
		];

		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ type: "assistant_merged", markdown: "first " });
		expect(result[1]).toMatchObject({
			type: "assistant_merged",
			markdown: "second answer",
			tokenRevealCss: {
				revealCount: 2,
				revealedCharCount: "second answer".length,
				baselineMs: -32,
			},
		});
	});

	it("still merges adjacent static assistant entries", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{ type: "assistant", id: "a1", markdown: "same", isStreaming: false },
			{ type: "assistant", id: "a2", markdown: " same suffix", isStreaming: false },
		];

		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result[0]?.type).toBe("assistant_merged");
		if (result[0]?.type === "assistant_merged") {
			expect(result[0].markdown).toBe("same same suffix");
			expect(result[0].tokenRevealCss).toBeUndefined();
		}
	});

	it("uses the last merged assistant key as the latest reveal target", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{
				type: "assistant",
				id: "a1",
				isStreaming: true,
				markdown: "",
				message: {
					chunks: [
						{ type: "message", block: { type: "text", text: "first" } },
						{
							type: "message",
							block: { type: "image", data: "abc", mimeType: "image/png" },
						},
						{ type: "message", block: { type: "text", text: "second" } },
					],
				},
			},
		];

		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result[0]?.type).toBe("assistant_merged");
		expect(getLatestRevealTargetKey(result)).toBe("a1");
	});

	it("keeps the latest assistant key even when the row has no text message group", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{
				type: "assistant",
				id: "a1",
				isStreaming: true,
				markdown: "",
				message: {
					chunks: [
						{
							type: "message",
							block: { type: "image", data: "abc", mimeType: "image/png" },
						},
					],
				},
			},
		];

		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result[0]?.type).toBe("assistant_merged");
		expect(getLatestRevealTargetKey(result)).toBe("a1");
	});

	it("appends scene display rows without copying current rows when the tail is not merged", () => {
		const currentRows = buildVirtualizedDisplayEntriesFromScene([
			{ type: "user", id: "u1", text: "prompt", isOptimistic: false },
		]);
		const originalSlice = currentRows.slice;

		currentRows.slice = () => {
			throw new Error("must not copy current virtualized rows for append");
		};

		try {
			const nextRows = appendVirtualizedDisplayEntriesFromScene(currentRows, [
				{ type: "assistant", id: "a1", markdown: "answer", isStreaming: false },
			]);

			expect(nextRows[0]).toBe(currentRows[0]);
			expect(getVirtualizedDisplayEntryKey(nextRows[1]!)).toBe("a1");
			expect(nextRows.map((entry) => getVirtualizedDisplayEntryKey(entry))).toEqual([
				"u1",
				"a1",
			]);
		} finally {
			currentRows.slice = originalSlice;
		}
	});

	it("merges a scene assistant tail without copying current rows", () => {
		const currentRows = buildVirtualizedDisplayEntriesFromScene([
			{ type: "assistant", id: "a1", markdown: "first ", isStreaming: false },
		]);
		const originalSlice = currentRows.slice;

		currentRows.slice = () => {
			throw new Error("must not copy current virtualized rows for a tail merge");
		};

		try {
			const nextRows = appendVirtualizedDisplayEntriesFromScene(currentRows, [
				{ type: "assistant", id: "a2", markdown: "second", isStreaming: false },
			]);

			expect(nextRows).toHaveLength(1);
			expect(nextRows[0]).not.toBe(currentRows[0]);
			expect(getVirtualizedDisplayEntryKey(nextRows[0]!)).toBe("a1");
			expect(nextRows[0]).toMatchObject({
				type: "assistant_merged",
				memberIds: ["a1", "a2"],
				markdown: "first second",
			});
		} finally {
			currentRows.slice = originalSlice;
		}
	});

	it("characterizes destructive scene-row shape changes by ordered display keys", () => {
		const initial: AgentPanelSceneEntryModel[] = [
			{ type: "user", id: "u1", text: "prompt", isOptimistic: false },
			{ type: "assistant", id: "a1", markdown: "first", isStreaming: false },
			{ type: "assistant", id: "a2", markdown: "second", isStreaming: false },
			{ type: "user", id: "u2", text: "next", isOptimistic: false },
		];
		const destructiveReplacement: AgentPanelSceneEntryModel[] = [
			{ type: "user", id: "u1", text: "prompt", isOptimistic: false },
			{ type: "user", id: "u2", text: "next", isOptimistic: false },
			{ type: "assistant", id: "a3", markdown: "replacement", isStreaming: false },
		];

		const initialKeys = buildVirtualizedDisplayEntriesFromScene(initial).map((entry) =>
			getVirtualizedDisplayEntryKey(entry)
		);
		const replacementKeys = buildVirtualizedDisplayEntriesFromScene(destructiveReplacement).map(
			(entry) => getVirtualizedDisplayEntryKey(entry)
		);

		expect(initialKeys).toEqual(["u1", "a1", "u2"]);
		expect(replacementKeys).toEqual(["u1", "u2", "a3"]);
		expect(replacementKeys.slice(0, initialKeys.length)).not.toEqual(initialKeys);
	});

	it("preserves timestampMs from scene assistant entry as a Date timestamp", () => {
		const knownMs = Date.parse("2026-06-01T00:00:00.000Z");
		const scene: AgentPanelSceneEntryModel[] = [
			{ type: "assistant", id: "a1", markdown: "hello", isStreaming: false, timestampMs: knownMs },
		];

		const result = buildVirtualizedDisplayEntriesFromScene(scene);

		expect(result).toHaveLength(1);
		const entry = result[0]!;
		expect(getVirtualizedDisplayEntryTimestampMs(entry)).toBe(knownMs);
	});

	it("resolveDisplayEntryThinkingDurationMs returns non-null durationMs when scene entries carry a timestamp", () => {
		const startMs = Date.parse("2026-06-01T00:00:00.000Z");
		const scene: AgentPanelSceneEntryModel[] = [
			{
				type: "assistant",
				id: "a1",
				markdown: "thinking result",
				isStreaming: false,
				timestampMs: startMs,
			},
		];
		const display = buildVirtualizedDisplayEntriesFromScene(scene);
		display.push({
			type: "thinking",
			id: "thinking-indicator",
			startedAtMs: startMs,
		});

		const nowMs = startMs + 6_000;
		expect(resolveDisplayEntryThinkingDurationMs(display, 1, nowMs)).toBe(6_000);
	});
});

describe("findLastAssistantSceneIndex", () => {
	it("returns -1 for empty array", () => {
		expect(findLastAssistantSceneIndex([])).toBe(-1);
	});

	it("returns the index of the last assistant entry", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{ type: "user", id: "u1", text: "hi", isOptimistic: false },
			{ type: "assistant", id: "a1", markdown: "...", isStreaming: false },
			{
				type: "tool_call",
				id: "tc1",
				title: "bash",
				status: "done",
			},
		];
		expect(findLastAssistantSceneIndex(scene)).toBe(1);
	});

	it("returns -1 when there are no assistant entries", () => {
		const scene: AgentPanelSceneEntryModel[] = [
			{ type: "user", id: "u1", text: "hi", isOptimistic: false },
		];
		expect(findLastAssistantSceneIndex(scene)).toBe(-1);
	});
});
