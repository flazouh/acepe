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

describe("buildRenderedTranscriptViewportRows", () => {
	it("adds local-only optimistic and planning rows before Rust has viewport rows", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [],
			offsetsPx: [],
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
			offsetsPx: [0],
			bufferStartIndex: 3,
			sceneEntries: [createOptimisticUserEntry("user-1", "Canonical message")],
			showLocalPlanningIndicator: false,
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.localOnly).toBe(false);
		expect(rows[0]?.entry.type).toBe("user");
	});
});
