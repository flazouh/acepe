import { describe, expect, it } from "bun:test";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { TranscriptViewportRow } from "../../../../../services/acp-types.js";
import { buildRenderedTranscriptViewportRows } from "../transcript-viewport-rendered-rows.js";

function createOptimisticUserEntry(id: string, text: string): AgentPanelSceneEntryModel {
	return {
		id,
		type: "user",
		text,
		isOptimistic: true,
	};
}

function createViewportUserRow(entryId: string, text: string): TranscriptViewportRow {
	return {
		rowId: entryId,
		sourceEntryId: entryId,
		kind: "user",
		version: `${entryId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "user",
			segments: [{ kind: "text", segmentId: `${entryId}:segment:0`, text }],
		},
		durationStartedAtMs: null,
	};
}

function createViewportToolRow(entryId: string): TranscriptViewportRow {
	return {
		rowId: entryId,
		sourceEntryId: entryId,
		kind: "tool",
		version: `${entryId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [],
		},
		durationStartedAtMs: null,
	};
}

function createSyntheticReviewEntry(): AgentPanelSceneEntryModel {
	return {
		id: "local:review",
		type: "tool_call",
		kind: "review",
		title: "Edited files",
		status: "done",
		reviewFiles: [
			{
				id: "src/lib/alpha.ts",
				filePath: "src/lib/alpha.ts",
				fileName: "alpha.ts",
				additions: 12,
				deletions: 2,
			},
			{
				id: "src/lib/beta.ts",
				filePath: "src/lib/beta.ts",
				fileName: "beta.ts",
				additions: 3,
				deletions: 1,
			},
		],
	};
}

describe("buildRenderedTranscriptViewportRows", () => {
	it("adds local-only optimistic and planning rows before Rust has viewport rows", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [],
			bufferStartIndex: 0,
			sceneEntries: [createOptimisticUserEntry("optimistic-user", "First message")],
			showLocalPlanningIndicator: true,
		});

		expect(rows.map((row) => row.entry.type)).toEqual(["user", "thinking"]);
		expect(rows.every((row) => row.localOnly)).toBe(true);
		expect(rows[0]?.entry).toMatchObject({
			id: "optimistic-user",
			type: "user",
			text: "First message",
			isOptimistic: true,
		});
		expect(rows[1]?.row.kind).toBe("awaitingPlaceholder");
	});

	it("does not duplicate a scene entry already represented by a Rust viewport row", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			sceneEntries: [createOptimisticUserEntry("user-1", "Canonical message")],
			showLocalPlanningIndicator: false,
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.localOnly).toBe(false);
		expect(rows[0]?.entry.type).toBe("user");
	});

	it("appends a local-only synthetic review row after canonical rows", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			sceneEntries: [],
			showLocalPlanningIndicator: false,
			syntheticReviewEntry: createSyntheticReviewEntry(),
		});

		expect(rows).toHaveLength(2);
		expect(rows[0]?.localOnly).toBe(false);
		expect(rows[1]?.localOnly).toBe(true);
		expect(rows[1]?.row.rowId).toBe("local:review");
		expect(rows[1]?.row.kind).toBe("tool");
		expect(rows[1]?.row.operationLinks).toEqual([]);
		expect(rows[1]?.entry).toMatchObject({
			id: "local:review",
			type: "tool_call",
			kind: "review",
			title: "Edited files",
			status: "done",
		});
	});

	it("does not append a synthetic review row when the caller omits it", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			sceneEntries: [],
			showLocalPlanningIndicator: false,
			syntheticReviewEntry: null,
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.row.rowId).toBe("user-1");
	});

	it("does not duplicate a synthetic review entry already represented by a Rust viewport row", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportToolRow("local:review")],
			bufferStartIndex: 3,
			sceneEntries: [createSyntheticReviewEntry()],
			showLocalPlanningIndicator: false,
			syntheticReviewEntry: createSyntheticReviewEntry(),
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.row.rowId).toBe("local:review");
		expect(rows[0]?.localOnly).toBe(false);
	});
});
