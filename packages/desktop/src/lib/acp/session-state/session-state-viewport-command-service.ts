import type {
	SessionGraphRevision,
	SessionStateEnvelope,
	TranscriptRowPageResult,
	TranscriptViewportRow,
	TranscriptViewportCommandRevision,
} from "../../services/acp-types.js";
import { invokeAsync } from "../../utils/tauri-client/invoke.js";

type ViewportCommandRevisionInput = {
	readonly graphRevision: number;
	readonly transcriptRevision: number;
	readonly lastEventSeq: number;
};

export type TranscriptViewportCommandEnvelopeResult = ReturnType<
	typeof invokeAsync<SessionStateEnvelope | null>
>;

type TranscriptRowPageWireResult =
	| ({
			readonly status: "current";
			readonly projection_version: string;
			readonly start_row_index: number;
			readonly total_row_count: number;
			readonly row_payload_bytes: number;
			readonly transcript_revision: number;
			readonly graph_revision: number;
			readonly last_event_seq: number;
			readonly rows: TranscriptViewportRow[];
	  })
	| { readonly status: "missing" }
	| {
			readonly status: "stale";
			readonly projection_version: string;
			readonly total_row_count: number;
			readonly transcript_revision: number;
			readonly graph_revision: number;
			readonly last_event_seq: number;
	  };

function commandRevisionFrom(
	revision: SessionGraphRevision | ViewportCommandRevisionInput
): TranscriptViewportCommandRevision {
	return {
		graphRevision: revision.graphRevision,
		transcriptRevision: revision.transcriptRevision,
		lastEventSeq: revision.lastEventSeq,
	};
}

export function transcriptRowPageResultFromWire(
	result: TranscriptRowPageWireResult
): TranscriptRowPageResult {
	if (result.status === "missing") {
		return { status: "missing" };
	}
	if (result.status === "stale") {
		return {
			status: "stale",
			projectionVersion: result.projection_version,
			totalRowCount: result.total_row_count,
			transcriptRevision: result.transcript_revision,
			graphRevision: result.graph_revision,
			lastEventSeq: result.last_event_seq,
		};
	}
	return {
		status: "current",
		projectionVersion: result.projection_version,
		startRowIndex: result.start_row_index,
		totalRowCount: result.total_row_count,
		rowPayloadBytes: result.row_payload_bytes,
		transcriptRevision: result.transcript_revision,
		graphRevision: result.graph_revision,
		lastEventSeq: result.last_event_seq,
		rows: result.rows,
	};
}

export function requestTranscriptViewportBuffer(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly requestGeneration?: number | null;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope | null>("acp_request_transcript_viewport_buffer", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		requestGeneration: input.requestGeneration ?? null,
	});
}

export function readTranscriptRowPage(input: {
	readonly sessionId: string;
	readonly startRowIndex: number;
	readonly limit: number;
	readonly expectedRevision: SessionGraphRevision | ViewportCommandRevisionInput;
}): ReturnType<typeof invokeAsync<TranscriptRowPageResult>> {
	return invokeAsync<TranscriptRowPageWireResult>("acp_read_transcript_row_page", {
		sessionId: input.sessionId,
		startRowIndex: input.startRowIndex,
		limit: input.limit,
		expectedRevision: commandRevisionFrom(input.expectedRevision),
	}).map(transcriptRowPageResultFromWire);
}
