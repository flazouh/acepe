import type { RpcProjectedMessage, RpcSessionSnapshot } from "@acepe/contracts";
import { MessageId, SessionId } from "@acepe/contracts";
import { emptyRpcSessionSnapshot } from "@acepe/contracts";
import { describe, expect, it } from "bun:test";

import {
	messagesFromSessionSnapshot,
	transcriptRowsFromSessionSnapshot,
} from "./transcript-from-snapshot.ts";

const sessionId = SessionId.make("session-1");

const userMessage: RpcProjectedMessage = {
	sessionId,
	sequence: 3,
	messageId: MessageId.make("message-user"),
	turnId: null,
	rowType: "user",
	content: { text: "Ping" },
};

describe("messagesFromSessionSnapshot", () => {
	it("points the viewport at snapshot.messages and no other projection", () => {
		const snapshot: RpcSessionSnapshot = {
			snapshotSequence: 3,
			session: null,
			messages: [userMessage],
			turns: [],
			activities: [],
			pendingApprovals: [],
		};
		expect(messagesFromSessionSnapshot(snapshot)).toBe(snapshot.messages);
		expect(transcriptRowsFromSessionSnapshot(snapshot)[0]?.rowId).toBe("message-user");
		expect(messagesFromSessionSnapshot(emptyRpcSessionSnapshot(0)).length).toBe(0);
	});
});
