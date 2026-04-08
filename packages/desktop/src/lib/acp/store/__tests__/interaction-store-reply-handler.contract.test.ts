import { describe, expect, it } from "bun:test";

import type { SessionProjectionSnapshot } from "../../../services/acp-types.js";
import { InteractionStore } from "../interaction-store.svelte.js";

describe("interaction store reply handler contract", () => {
	it("hydrates plan approvals from canonical reply handlers even without a numeric transport id", () => {
		const store = new InteractionStore();

		store.replaceSessionProjection({
			session: {
				session_id: "session-1",
				agent_id: "copilot",
				last_event_seq: 5,
				turn_state: "Idle",
				message_count: 0,
				last_agent_message_id: null,
				active_tool_call_ids: [],
				completed_tool_call_ids: [],
			},
			operations: [],
			interactions: [
				{
					id: "plan-approval-http",
					session_id: "session-1",
					kind: "PlanApproval",
					state: "Pending",
					json_rpc_request_id: null,
					reply_handler: {
						kind: "http",
						requestId: "plan-approval-http-route",
					},
					tool_reference: {
						messageId: "message-plan",
						callId: "tool-plan",
					},
					responded_at_event_seq: null,
					response: null,
					payload: {
						PlanApproval: {
							source: "CreatePlan",
						},
					},
				},
			],
		} satisfies SessionProjectionSnapshot);

		expect(store.planApprovalsPending.get("plan-approval-http")).toEqual({
			id: "plan-approval-http",
			kind: "plan_approval",
			source: "create_plan",
			sessionId: "session-1",
			tool: {
				messageID: "message-plan",
				callID: "tool-plan",
			},
			jsonRpcRequestId: undefined,
			replyHandler: {
				kind: "http",
				requestId: "plan-approval-http-route",
			},
			status: "pending",
		});
	});
});
