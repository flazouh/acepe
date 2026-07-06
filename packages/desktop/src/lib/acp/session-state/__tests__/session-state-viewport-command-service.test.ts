import { describe, expect, it } from "bun:test";
import type { TranscriptViewportRow } from "../../../services/acp-types.js";
import { transcriptRowPageResultFromWire } from "../session-state-viewport-command-service.js";

function row(rowId: string): TranscriptViewportRow {
	return {
		rowId,
		sourceEntryId: rowId,
		kind: "assistantText",
		version: `${rowId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: { kind: "transcript", role: "assistant", segments: [] },
	};
}

describe("transcriptRowPageResultFromWire", () => {
	it("normalizes snake_case row page command fields to app camelCase", () => {
		const result = transcriptRowPageResultFromWire({
			status: "current",
			projection_version: "transcript_viewport_row:v1",
			start_row_index: 256,
			total_row_count: 512,
			row_payload_bytes: 42,
			transcript_revision: 7,
			graph_revision: 11,
			last_event_seq: 13,
			rows: [row("row-256")],
		});

		expect(result).toEqual({
			status: "current",
			projectionVersion: "transcript_viewport_row:v1",
			startRowIndex: 256,
			totalRowCount: 512,
			rowPayloadBytes: 42,
			transcriptRevision: 7,
			graphRevision: 11,
			lastEventSeq: 13,
			rows: [row("row-256")],
		});
	});
});
