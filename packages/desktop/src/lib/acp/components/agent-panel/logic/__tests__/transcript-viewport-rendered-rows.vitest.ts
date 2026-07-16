import { describe, expect, it } from "vitest";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { TranscriptViewportRow } from "../../../../../services/acp-types.js";
import { buildRenderableTranscriptViewportRows } from "../transcript-viewport-rendered-rows.js";

function createOptimisticUserEntry(id: string, text: string): AgentPanelSceneEntryModel {
	return {
		id,
		type: "user",
		text,
		isOptimistic: true,
	};
}

function createCanonicalUserEntry(id: string, text: string): AgentPanelSceneEntryModel {
	return {
		id,
		type: "user",
		text,
		chunks: [{ kind: "text", text }],
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

describe("buildRenderableTranscriptViewportRows", () => {
	it("appends only the explicit optimistic row after canonical tool rows", () => {
		const rows = buildRenderableTranscriptViewportRows({
			bufferRows: [createViewportToolRow("tool-tail")],
			bufferStartIndex: 100,
			optimisticUserEntry: createOptimisticUserEntry("pending-user", "Pending message"),
			localPlaceholderMode: "none",
		});

		expect(rows.map((row) => row.row.rowId)).toEqual([
			"tool-tail",
			"local:optimistic:pending-user",
		]);
		expect(rows.map((row) => row.index)).toEqual([100, 101]);
	});
});
