import * as Effect from "effect/Effect";
import type {
	SessionGraphRevision,
	SessionStateEnvelope,
	TranscriptRowPageResult,
	TranscriptScope,
	TranscriptViewportRow,
} from "../../services/acp-types.js";

type ViewportCommandRevisionInput = {
	readonly graphRevision: number;
	readonly transcriptRevision: number;
	readonly lastEventSeq: number;
};

export type TranscriptViewportCommandEnvelopeResult = Effect.Effect<
	SessionStateEnvelope | null,
	never
>;

type TranscriptRowPageWireResult =
	| {
			readonly status: "current";
			readonly projection_version: string;
			readonly start_row_index: number;
			readonly total_row_count: number;
			readonly row_payload_bytes: number;
			readonly transcript_revision: number;
			readonly graph_revision: number;
			readonly last_event_seq: number;
			readonly rows: TranscriptViewportRow[];
	  }
	| { readonly status: "missing" }
	| {
			readonly status: "stale";
			readonly projection_version: string;
			readonly total_row_count: number;
			readonly transcript_revision: number;
			readonly graph_revision: number;
			readonly last_event_seq: number;
	  };

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

// Viewport page commands have no Electrobun backend yet. packages/server
// has no equivalent projector (same acknowledged gap as
// orchestration-canonical-bridge.ts: "packages/server's projector does not
// carry transcript/operations/interactions/turnState yet"). Report the
// command as honestly unavailable: `null` / `{ status: "missing" }` are
// real, already-modeled "no data" results these callers already handle,
// not fabricated content. `TranscriptRowsController` covers the common
// root-scope case with real data from the canonical transcript entries
// instead of calling this at all under Electrobun (see
// transcript-viewport-rows-from-entries.ts); this guard is what
// `TaskTranscriptDialogController`'s operation-scoped reads (and any other
// caller) fall back to.
export function requestTranscriptViewportBuffer(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly requestGeneration?: number | null;
}): TranscriptViewportCommandEnvelopeResult {
	return Effect.succeed(null);
}

export function readTranscriptRowPage(input: {
	readonly sessionId: string;
	readonly scope: TranscriptScope;
	readonly startRowIndex: number;
	readonly limit: number;
	readonly expectedRevision: SessionGraphRevision | ViewportCommandRevisionInput;
}): Effect.Effect<TranscriptRowPageResult, never> {
	return Effect.succeed({ status: "missing" });
}
