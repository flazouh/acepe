import type {
	SessionGraphRevision,
	SessionStateEnvelope,
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

function commandRevisionFrom(
	revision: SessionGraphRevision | ViewportCommandRevisionInput
): TranscriptViewportCommandRevision {
	return {
		graphRevision: revision.graphRevision,
		transcriptRevision: revision.transcriptRevision,
		lastEventSeq: revision.lastEventSeq,
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

export function scrollTranscriptViewport(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly viewportHeightPx: number;
	readonly offsetPx: number;
	readonly requestGeneration?: number | null;
	readonly forceFresh?: boolean | null;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope | null>("acp_scroll_transcript_viewport", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		viewportHeightPx: input.viewportHeightPx,
		offsetPx: input.offsetPx,
		requestGeneration: input.requestGeneration ?? null,
		forceFresh: input.forceFresh ?? null,
	});
}

export function revealTranscriptViewportRow(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly viewportHeightPx: number;
	readonly rowId: string | null;
	readonly requestGeneration?: number | null;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope | null>("acp_reveal_transcript_viewport_row", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		viewportHeightPx: input.viewportHeightPx,
		rowId: input.rowId,
		requestGeneration: input.requestGeneration ?? null,
	});
}

export function resizeTranscriptViewport(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly viewportHeightPx: number;
	readonly requestGeneration?: number | null;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope | null>("acp_resize_transcript_viewport", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		viewportHeightPx: input.viewportHeightPx,
		requestGeneration: input.requestGeneration ?? null,
	});
}

export function confirmTranscriptViewportHeight(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly viewportHeightPx: number;
	readonly rowId: string;
	readonly rowVersion: string;
	readonly heightPx: number;
	readonly viewportOffsetPx: number | null;
	readonly requestGeneration?: number | null;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope | null>("acp_confirm_transcript_viewport_height", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		viewportHeightPx: input.viewportHeightPx,
		rowId: input.rowId,
		rowVersion: input.rowVersion,
		heightPx: input.heightPx,
		viewportOffsetPx: input.viewportOffsetPx,
		requestGeneration: input.requestGeneration ?? null,
	});
}
