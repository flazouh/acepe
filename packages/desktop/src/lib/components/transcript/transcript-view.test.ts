import type { RpcProjectedMessage } from "@acepe/contracts";
import { MessageId, SessionId } from "@acepe/contracts";
import { describe, expect, it } from "bun:test";

import { transcriptViewFromMessages } from "./transcript-view.ts";

const sessionId = SessionId.make("session-1");

const userMessage: RpcProjectedMessage = {
	sessionId,
	sequence: 3,
	messageId: MessageId.make("message-user"),
	turnId: null,
	rowType: "user",
	content: { text: "Ping" },
};

describe("transcriptViewFromMessages", () => {
	it("renders projection rows with JS overflow-anchor none and content-visibility auto", () => {
		const view = transcriptViewFromMessages({
			messages: [userMessage],
			ariaLabel: "Transcript",
		});
		expect(view.ariaLabel).toBe("Transcript");
		expect(view.overflowAnchor).toBe("none");
		expect(view.contentVisibility).toBe("auto");
		expect(view.rows[0]?.rowId).toBe("message-user");
		expect(view.rows[0]?.text).toBe("Ping");
	});
});
