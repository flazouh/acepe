import { describe, expect, it } from "bun:test";
import { MessageId, SessionId } from "@acepe/contracts";

import { transcriptViewFromMessages } from "./transcript-view.ts";

const sessionId = SessionId.make("session-1");

describe("transcript.svelte view contract", () => {
	it("keys rows on projection messageId and disables overflow-anchor", () => {
		const view = transcriptViewFromMessages({
			messages: [
				{
					sessionId,
					sequence: 3,
					messageId: MessageId.make("message-user"),
					turnId: null,
					rowType: "user",
					content: { text: "Ping" },
				},
			],
			ariaLabel: "Transcript",
		});
		expect(view.rows[0]?.rowId).toBe("message-user");
		expect(view.overflowAnchor).toBe("none");
		expect(view.contentVisibility).toBe("auto");
	});
});
