import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";
import type { SessionProjectionSnapshot } from "../../../../services/acp-types.js";
import { InteractionStore } from "../../interaction-store.svelte.js";

const getSessionProjectionMock = mock(() => okAsync(createProjectionSnapshot()));

mock.module("../../api.js", () => ({
	api: {
		getSessionProjection: getSessionProjectionMock,
	},
}));

import { SessionProjectionHydrator } from "../session-projection-hydrator.js";

describe("SessionProjectionHydrator", () => {
	beforeEach(() => {
		getSessionProjectionMock.mockClear();
		getSessionProjectionMock.mockImplementation(() => okAsync(createProjectionSnapshot()));
	});

	it("hydrates pending, answered, and plan approval interactions from the backend projection", async () => {
		const interactions = new InteractionStore();
		const hydrator = new SessionProjectionHydrator(interactions);

		const result = await hydrator.hydrateSession("session-1");

		expect(result.isOk()).toBe(true);
		expect(getSessionProjectionMock).toHaveBeenCalledWith("session-1");
		expect(interactions.permissionsPending.get("permission-1")?.tool?.callID).toBe("tool-permission");
		expect(interactions.questionsPending.get("question-pending")?.questions[0]?.question).toBe(
			"Choose a path"
		);
		expect(interactions.answeredQuestions.get("tool-question")).toEqual({
			questions: [
				{
					question: "Select files",
					header: "Files",
					options: [
						{ label: "README.md", description: "Docs" },
						{ label: "AGENTS.md", description: "Rules" },
					],
					multiSelect: true,
				},
			],
			answers: {
				"Select files": ["README.md", "AGENTS.md"],
			},
			answeredAt: 7,
			cancelled: undefined,
		});
		expect(interactions.planApprovalsPending.get("plan-approval-1")).toEqual({
			id: "plan-approval-1",
			kind: "plan_approval",
			source: "create_plan",
			sessionId: "session-1",
			tool: {
				messageID: "message-plan",
				callID: "tool-plan",
			},
			jsonRpcRequestId: 99,
			status: "approved",
		});
	});

	it("clears all interaction projections for a removed session", async () => {
		const interactions = new InteractionStore();
		const hydrator = new SessionProjectionHydrator(interactions);

		await hydrator.hydrateSession("session-1");
		hydrator.clearSession("session-1");

		expect(interactions.permissionsPending.size).toBe(0);
		expect(interactions.questionsPending.size).toBe(0);
		expect(interactions.answeredQuestions.size).toBe(0);
		expect(interactions.planApprovalsPending.size).toBe(0);
	});
});

function createProjectionSnapshot(): SessionProjectionSnapshot {
	return {
		session: {
			session_id: "session-1",
			agent_id: "claude-code",
			last_event_seq: 7,
			turn_state: "Idle",
			message_count: 3,
			last_agent_message_id: "message-3",
			active_tool_call_ids: [],
			completed_tool_call_ids: ["tool-permission", "tool-question", "tool-plan"],
		},
		operations: [],
		interactions: [
			{
				id: "permission-1",
				session_id: "session-1",
				kind: "Permission",
				state: "Pending",
				json_rpc_request_id: 55,
				tool_reference: {
					messageId: "message-permission",
					callId: "tool-permission",
				},
				responded_at_event_seq: null,
				response: null,
				payload: {
					Permission: {
						id: "permission-1",
						sessionId: "session-1",
						jsonRpcRequestId: 55,
						permission: "ReadFile",
						patterns: ["README.md"],
						metadata: { path: "README.md" },
						always: ["project"],
						tool: {
							messageId: "message-permission",
							callId: "tool-permission",
						},
					},
				},
			},
			{
				id: "question-pending",
				session_id: "session-1",
				kind: "Question",
				state: "Pending",
				json_rpc_request_id: 77,
				tool_reference: {
					messageId: "message-question",
					callId: "tool-question-pending",
				},
				responded_at_event_seq: null,
				response: null,
				payload: {
					Question: {
						id: "question-pending",
						sessionId: "session-1",
						jsonRpcRequestId: 77,
						questions: [
							{
								question: "Choose a path",
								header: "Path",
								options: [{ label: "src", description: "Source" }],
								multiSelect: false,
							},
						],
						tool: {
							messageId: "message-question",
							callId: "tool-question-pending",
						},
					},
				},
			},
			{
				id: "question-answered",
				session_id: "session-1",
				kind: "Question",
				state: "Answered",
				json_rpc_request_id: 88,
				tool_reference: {
					messageId: "message-question",
					callId: "tool-question",
				},
				responded_at_event_seq: 7,
				response: {
					kind: "question",
					answers: [["README.md", "AGENTS.md"]],
				},
				payload: {
					Question: {
						id: "question-answered",
						sessionId: "session-1",
						jsonRpcRequestId: 88,
						questions: [
							{
								question: "Select files",
								header: "Files",
								options: [
									{ label: "README.md", description: "Docs" },
									{ label: "AGENTS.md", description: "Rules" },
								],
								multiSelect: true,
							},
						],
						tool: {
							messageId: "message-question",
							callId: "tool-question",
						},
					},
				},
			},
			{
				id: "plan-approval-1",
				session_id: "session-1",
				kind: "PlanApproval",
				state: "Approved",
				json_rpc_request_id: 99,
				tool_reference: {
					messageId: "message-plan",
					callId: "tool-plan",
				},
				responded_at_event_seq: 6,
				response: {
					kind: "plan_approval",
					approved: true,
				},
				payload: {
					PlanApproval: {
						source: "CreatePlan",
					},
				},
			},
		],
	};
}
