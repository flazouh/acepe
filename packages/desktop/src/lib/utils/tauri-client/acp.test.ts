import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InteractionReplyRequest } from "../../acp/types/interaction-reply-request.js";
import { CMD } from "./commands.js";

const mockInvokeAsync = vi.fn((_cmd: string, _args?: Record<string, unknown>) =>
	okAsync(undefined)
);

vi.mock("./invoke.js", () => ({
	invokeAsync: (cmd: string, args?: Record<string, unknown>) => mockInvokeAsync(cmd, args),
}));

import { acp } from "./acp.js";

describe("tauri ACP client", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("wraps canonical permission replies in the request argument and Rust wire format expected by Tauri", async () => {
		const request: InteractionReplyRequest = {
			sessionId: "session-1",
			interactionId: "permission-1",
			replyHandler: {
				kind: "json-rpc",
				requestId: 42,
			},
			payload: {
				kind: "permission",
				reply: "once",
				optionId: "allow",
			},
		};

		await acp.replyInteraction(request);

		expect(mockInvokeAsync).toHaveBeenCalledWith(CMD.acp.reply_interaction, {
			request: {
				sessionId: "session-1",
				interactionId: "permission-1",
				replyHandler: {
					kind: "json_rpc",
					requestId: "42",
				},
				payload: {
					kind: "permission",
					reply: "once",
					option_id: "allow",
				},
			},
		});
	});

	it("serializes canonical question replies with snake_case payload fields", async () => {
		const request: InteractionReplyRequest = {
			sessionId: "session-2",
			interactionId: "question-1",
			replyHandler: {
				kind: "http",
				requestId: "question-1",
			},
			payload: {
				kind: "question",
				answers: [{ questionIndex: 0, answers: ["yes"] }],
				answerMap: {
					confirm: "yes",
				},
			},
		};

		await acp.replyInteraction(request);

		expect(mockInvokeAsync).toHaveBeenCalledWith(CMD.acp.reply_interaction, {
			request: {
				sessionId: "session-2",
				interactionId: "question-1",
				replyHandler: {
					kind: "http",
					requestId: "question-1",
				},
				payload: {
					kind: "question",
					answers: [{ questionIndex: 0, answers: ["yes"] }],
					answer_map: {
						confirm: "yes",
					},
				},
			},
		});
	});
});
