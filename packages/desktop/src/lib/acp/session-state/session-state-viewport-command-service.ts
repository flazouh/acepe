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
	typeof invokeAsync<SessionStateEnvelope>
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

export function scrollTranscriptViewport(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly viewportHeightPx: number;
	readonly offsetPx: number;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope>("acp_scroll_transcript_viewport", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		viewportHeightPx: input.viewportHeightPx,
		offsetPx: input.offsetPx,
	});
}

export function revealTranscriptViewportRow(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly viewportHeightPx: number;
	readonly rowId: string | null;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope>("acp_reveal_transcript_viewport_row", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		viewportHeightPx: input.viewportHeightPx,
		rowId: input.rowId,
	});
}

export function resizeTranscriptViewport(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly viewportHeightPx: number;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope>("acp_resize_transcript_viewport", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		viewportHeightPx: input.viewportHeightPx,
	});
}

export function confirmTranscriptViewportHeight(input: {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision | ViewportCommandRevisionInput;
	readonly viewportHeightPx: number;
	readonly rowId: string;
	readonly rowVersion: string;
	readonly heightPx: number;
}): TranscriptViewportCommandEnvelopeResult {
	return invokeAsync<SessionStateEnvelope>("acp_confirm_transcript_viewport_height", {
		sessionId: input.sessionId,
		revision: commandRevisionFrom(input.revision),
		viewportHeightPx: input.viewportHeightPx,
		rowId: input.rowId,
		rowVersion: input.rowVersion,
		heightPx: input.heightPx,
	});
}
