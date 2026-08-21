import type { RpcProjectedMessage, RpcSessionSnapshot } from "@acepe/contracts";
import {
	rowsFromProjectedMessages,
	type TranscriptViewportRow,
} from "@acepe/transcript-viewport";

/** The viewport reads only `snapshot.messages` from the session projection. */
export const messagesFromSessionSnapshot = (
	snapshot: RpcSessionSnapshot,
): ReadonlyArray<RpcProjectedMessage> => snapshot.messages;

export const transcriptRowsFromSessionSnapshot = (
	snapshot: RpcSessionSnapshot,
): ReadonlyArray<TranscriptViewportRow> =>
	rowsFromProjectedMessages(snapshot.messages);
