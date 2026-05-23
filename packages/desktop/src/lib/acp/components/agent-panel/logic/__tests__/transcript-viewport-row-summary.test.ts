import { describe, expect, it } from "vitest";

import {
	buildTranscriptViewportRowsSummary,
	createTranscriptViewportRowsReadModel,
} from "../transcript-viewport-row-summary.js";
import type { SceneDisplayRow } from "../scene-display-rows.js";

describe("createTranscriptViewportRowsReadModel", () => {
	it("keeps the selected summary stable for the same rows reference", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const rows = [userRow("user-1"), assistantRow("assistant-1")];

		const summary = readModel.applyRows({ rows, reason: "rows-updated" });

		expect(readModel.applyRows({ rows, reason: "rows-updated" })).toBe(summary);
		expect(readModel.selectSummary()).toBe(summary);
	});

	it("updates append-only rows without rebuilding existing anchor keys", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = firstRows.concat(toolRow("tool-1"));

		const nextSummary = readModel.applyRows({
			rows: nextRows,
			reason: "rows-updated",
		});

		expect(nextSummary).not.toBe(firstSummary);
		expect(nextSummary.count).toBe(3);
		expect(nextSummary.firstKey).toBe("user-1");
		expect(nextSummary.lastKey).toBe("tool-1");
		expect(nextSummary.latestUserKey).toBe("user-1");
		expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
		expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
		expect(nextSummary.hasToolCallEntry).toBe(true);
	});

	it("handles a waiting row append without changing anchor keys", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});

		const waitingSummary = readModel.applyRows({
			rows: firstRows.concat(thinkingRow("Working")),
			reason: "waiting-row-appended",
		});

		expect(waitingSummary.lastKey).toBe("thinking-indicator");
		expect(waitingSummary.latestUserKey).toBe("user-1");
		expect(waitingSummary.rowKeys).toEqual([
			"user-1",
			"assistant-1",
			"thinking-indicator",
		]);
		expect(waitingSummary.anchorEligibleKeys).toBe(firstSummary.anchorEligibleKeys);
	});

	it("updates a replaced tail row from the previous summary", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), thinkingRow("Working")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "waiting-row-appended",
		});
		const nextRows = [firstRows[0]!, assistantRow("assistant-1")];

		const nextSummary = readModel.applyRows({
			rows: nextRows,
			reason: "rows-updated",
		});

		expect(nextSummary.count).toBe(2);
		expect(nextSummary.firstKey).toBe("user-1");
		expect(nextSummary.lastKey).toBe("assistant-1");
		expect(nextSummary.latestUserKey).toBe("user-1");
		expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1"]);
		expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1"]);
		expect(nextSummary.anchorEligibleKeys).not.toBe(firstSummary.anchorEligibleKeys);
	});

	it("updates tail-derived boolean facts without losing earlier matches", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [toolRow("tool-1"), assistantRow("assistant-1", { tokenReveal: true })];
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});

		const nextSummary = readModel.applyRows({
			rows: [firstRows[0]!, assistantRow("assistant-2")],
			reason: "rows-updated",
		});

		expect(nextSummary.hasToolCallEntry).toBe(true);
		expect(nextSummary.hasTokenRevealAssistantEntry).toBe(false);
		expect(nextSummary.hasLiveAssistantDisplayEntry).toBe(false);
	});

	it("selects fixed thinking durations from the next timed row", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
		readModel.applyRows({
			rows: [
				assistantRow("assistant-1", { thought: true, timestampMs: startedAtMs }),
				userRow("user-2", { timestampMs: startedAtMs + 4_000 }),
			],
			reason: "rows-updated",
		});

		expect(readModel.selectThinkingDurationMs(0, startedAtMs + 30_000)).toBe(4_000);
		expect(readModel.selectThinkingDurationMs(1, startedAtMs + 30_000)).toBeNull();
	});

	it("selects elapsed thinking durations for waiting rows", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
		readModel.applyRows({
			rows: [userRow("user-1"), thinkingRow("Working", startedAtMs)],
			reason: "waiting-row-appended",
		});

		expect(readModel.selectThinkingDurationMs(1, startedAtMs + 2_500)).toBe(2_500);
	});

	it("selects and caches the native fallback tail window", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const rows = [
			userRow("user-1"),
			assistantRow("assistant-1"),
			toolRow("tool-1"),
		];
		readModel.applyRows({ rows, reason: "rows-updated" });

		const window = readModel.selectNativeFallbackWindow(2);

		expect(window).toEqual([
			{ entry: rows[1], index: 1 },
			{ entry: rows[2], index: 2 },
		]);
		expect(readModel.selectNativeFallbackWindow(2)).toBe(window);

		const nextRows = rows.concat(userRow("user-2"));
		readModel.applyRows({ rows: nextRows, reason: "rows-updated" });

		expect(readModel.selectNativeFallbackWindow(2)).toEqual([
			{ entry: nextRows[2], index: 2 },
			{ entry: nextRows[3], index: 3 },
		]);
	});

	it("selects nearby row diagnostics without exposing row slicing to callers", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		readModel.applyRows({
			rows: [
				userRow("user-1"),
				assistantRow("assistant-1"),
				toolRow("tool-1"),
				userRow("user-2"),
			],
			reason: "rows-updated",
		});

		expect(readModel.selectNearbyRowDiagnostics(2, 1)).toEqual([
			{ type: "assistant_merged", key: "assistant-1" },
			{ type: "tool_call", key: "tool-1" },
			{ type: "user", key: "user-2" },
		]);
		expect(readModel.selectNearbyRowDiagnostics(undefined, 1)).toEqual([
			{ type: "user", key: "user-1" },
			{ type: "assistant_merged", key: "assistant-1" },
		]);
	});
});

describe("buildTranscriptViewportRowsSummary", () => {
	it("builds the same summary shape used by the viewport controller", () => {
		const summary = buildTranscriptViewportRowsSummary(
			[userRow("user-1"), assistantRow("assistant-1"), thinkingRow("Working")],
			"waiting-row-appended"
		);

		expect(summary).toEqual({
			version: 3,
			count: 3,
			firstKey: "user-1",
			lastKey: "thinking-indicator",
			latestUserKey: "user-1",
			rowKeys: ["user-1", "assistant-1", "thinking-indicator"],
			anchorEligibleKeys: ["user-1", "assistant-1"],
			hasLiveAssistantDisplayEntry: false,
			hasTokenRevealAssistantEntry: false,
			hasToolCallEntry: false,
			reason: "waiting-row-appended",
		});
	});
});

function userRow(
	id: string,
	options: { readonly timestampMs?: number } = {}
): SceneDisplayRow {
	return {
		id,
		type: "user",
		text: "Prompt",
		timestamp: options.timestampMs === undefined ? undefined : new Date(options.timestampMs),
	} as unknown as SceneDisplayRow;
}

function assistantRow(
	id: string,
	options: {
		readonly tokenReveal?: boolean;
		readonly isStreaming?: boolean;
		readonly thought?: boolean;
		readonly timestampMs?: number;
	} = {}
): SceneDisplayRow {
	return {
		key: id,
		type: "assistant_merged",
		memberIds: [id],
		markdown: "Answer",
		message: {
			chunks: [
				options.thought
					? { type: "thought", block: { type: "text", text: "Thinking" } }
					: { type: "message", block: { type: "text", text: "Answer" } },
			],
		},
		timestamp: options.timestampMs === undefined ? undefined : new Date(options.timestampMs),
		isStreaming: options.isStreaming,
		tokenRevealCss: options.tokenReveal
			? {
					revealCount: 1,
					revealedCharCount: 1,
					baselineMs: 0,
					tokStepMs: 1,
					tokFadeDurMs: 1,
					mode: "smooth",
				}
			: undefined,
	} as SceneDisplayRow;
}

function toolRow(id: string): SceneDisplayRow {
	return {
		id,
		type: "tool_call",
		title: "Run",
		status: "done",
	} as unknown as SceneDisplayRow;
}

function thinkingRow(label: string, startedAtMs = 1): SceneDisplayRow {
	return {
		id: "thinking-indicator",
		type: "thinking",
		startedAtMs,
		label,
	} as SceneDisplayRow;
}
