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
