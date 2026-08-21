import type { RpcProjectedMessage } from "@acepe/contracts";
import {
	rowsFromProjectedMessages,
	TRANSCRIPT_CONTENT_VISIBILITY,
	TRANSCRIPT_OVERFLOW_ANCHOR,
	type TranscriptViewportRow,
} from "@acepe/transcript-viewport";

export type TranscriptView = {
	readonly rows: ReadonlyArray<TranscriptViewportRow>;
	readonly ariaLabel: string;
	readonly overflowAnchor: typeof TRANSCRIPT_OVERFLOW_ANCHOR;
	readonly contentVisibility: typeof TRANSCRIPT_CONTENT_VISIBILITY;
};

export const transcriptViewFromMessages = (input: {
	readonly messages: ReadonlyArray<RpcProjectedMessage>;
	readonly ariaLabel: string;
}): TranscriptView => ({
	rows: rowsFromProjectedMessages(input.messages),
	ariaLabel: input.ariaLabel,
	overflowAnchor: TRANSCRIPT_OVERFLOW_ANCHOR,
	contentVisibility: TRANSCRIPT_CONTENT_VISIBILITY,
});
