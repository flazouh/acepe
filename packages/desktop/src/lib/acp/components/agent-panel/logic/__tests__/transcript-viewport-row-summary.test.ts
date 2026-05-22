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
		expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
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
		expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1"]);
		expect(nextSummary.anchorEligibleKeys).not.toBe(firstSummary.anchorEligibleKeys);
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
			anchorEligibleKeys: ["user-1", "assistant-1"],
			reason: "waiting-row-appended",
		});
	});
});

function userRow(id: string): SceneDisplayRow {
	return {
		id,
		type: "user",
		text: "Prompt",
	} as unknown as SceneDisplayRow;
}

function assistantRow(id: string): SceneDisplayRow {
	return {
		key: id,
		type: "assistant_merged",
		memberIds: [id],
		markdown: "Answer",
		message: { chunks: [{ type: "message", block: { type: "text", text: "Answer" } }] },
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

function thinkingRow(label: string): SceneDisplayRow {
	return {
		id: "thinking-indicator",
		type: "thinking",
		startedAtMs: 1,
		label,
	} as SceneDisplayRow;
}
