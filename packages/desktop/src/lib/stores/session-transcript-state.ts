import type { RpcProjectedMessage, RpcSessionSnapshot } from "@acepe/contracts";
import type { TracerTranscriptRow } from "@acepe/ui/tracer-transcript";
import * as Arr from "effect/Array";

const isTranscriptMessage = (
	message: RpcProjectedMessage,
): message is Extract<RpcProjectedMessage, { readonly rowType: "user" | "assistant" }> =>
	message.rowType === "user" || message.rowType === "assistant";

export const transcriptRowsFromSnapshot = (
	snapshot: RpcSessionSnapshot,
): ReadonlyArray<TracerTranscriptRow> =>
	Arr.map(Arr.filter(snapshot.messages, isTranscriptMessage), (message) => ({
		key: message.messageId,
		role: message.rowType,
		text: message.content.text,
	}));
