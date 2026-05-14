import {
	reduceTranscriptViewportBatch,
	type TranscriptViewportState,
	type TranscriptViewportStep,
} from "./transcript-viewport-controller.js";
import type { TranscriptViewportEvent } from "./transcript-viewport-events.js";

export function replayTranscriptViewportEvents(
	initialState: TranscriptViewportState,
	events: readonly TranscriptViewportEvent[]
): TranscriptViewportStep {
	return reduceTranscriptViewportBatch(initialState, events);
}
