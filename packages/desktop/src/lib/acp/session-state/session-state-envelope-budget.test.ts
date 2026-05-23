import { describe, expect, it } from "vitest";

import type { SessionStateEnvelope } from "../../services/acp-types.js";
import {
	checkSessionStateEnvelopeByteBudget,
	getSessionStateEnvelopeByteBudget,
	SESSION_STATE_ENVELOPE_BYTE_BUDGETS,
} from "./session-state-envelope-budget.js";

const revision = {
	graphRevision: 1,
	transcriptRevision: 1,
	lastEventSeq: 1,
};

const idleActivity = {
	kind: "idle",
	activeOperationCount: 0,
	activeSubagentCount: 0,
	dominantOperationId: null,
	blockingInteractionId: null,
} as const;

function createEnvelope(payload: SessionStateEnvelope["payload"]): SessionStateEnvelope {
	return {
		sessionId: "session-1",
		graphRevision: 1,
		lastEventSeq: 1,
		payload,
	};
}

describe("session-state envelope byte budgets", () => {
	it("defines a byte budget for every session-state payload kind", () => {
		expect(SESSION_STATE_ENVELOPE_BYTE_BUDGETS.map((budget) => budget.kind).sort()).toEqual([
			"assistantTextDelta",
			"capabilities",
			"delta",
			"lifecycle",
			"plan",
			"snapshot",
			"telemetry",
		]);
	});

	it("keeps tiny assistant text deltas much smaller than transcript deltas", () => {
		expect(getSessionStateEnvelopeByteBudget("assistantTextDelta")).toBeLessThan(
			getSessionStateEnvelopeByteBudget("delta")
		);
		expect(getSessionStateEnvelopeByteBudget("delta")).toBeLessThan(
			getSessionStateEnvelopeByteBudget("snapshot")
		);
	});

	it("accepts a normal small assistant text delta", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "assistantTextDelta",
				delta: {
					turnId: "turn-1",
					rowId: "assistant-1",
					charOffset: 0,
					deltaText: "hello",
					producedAtMonotonicMs: 12,
					revision: 1,
				},
			})
		);

		expect(result.ok).toBe(true);
		expect(result.kind).toBe("assistantTextDelta");
	});

	it("rejects oversized assistant text deltas so token updates stay small", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "assistantTextDelta",
				delta: {
					turnId: "turn-1",
					rowId: "assistant-1",
					charOffset: 0,
					deltaText: "x".repeat(getSessionStateEnvelopeByteBudget("assistantTextDelta")),
					producedAtMonotonicMs: 12,
					revision: 1,
				},
			})
		);

		expect(result).toMatchObject({
			ok: false,
			kind: "assistantTextDelta",
			maxBytes: getSessionStateEnvelopeByteBudget("assistantTextDelta"),
		});
	});

	it("accepts graph-only delta patches inside the delta budget", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "delta",
				delta: {
					fromRevision: revision,
					toRevision: {
						graphRevision: 2,
						transcriptRevision: 1,
						lastEventSeq: 2,
					},
					activity: idleActivity,
					turnState: "Idle",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity"],
				},
			})
		);

		expect(result.ok).toBe(true);
		expect(result.kind).toBe("delta");
	});

	it("rejects oversized delta envelopes so graph patches stay small", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "delta",
				delta: {
					fromRevision: revision,
					toRevision: {
						graphRevision: 2,
						transcriptRevision: 1,
						lastEventSeq: 2,
					},
					activity: idleActivity,
					turnState: "Idle",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [
						{
							id: "op-1",
							session_id: "session-1",
							tool_call_id: "tool-1",
							name: "bash",
							kind: "execute",
							provider_status: "completed",
							title: "Run",
							arguments: {
								kind: "execute",
								command: "printf oversized",
							},
							progressive_arguments: null,
							result: {
								stdout: "x".repeat(getSessionStateEnvelopeByteBudget("delta")),
								stderr: null,
								exitCode: 0,
							},
							command: "printf oversized",
							normalized_todos: null,
							parent_tool_call_id: null,
							parent_operation_id: null,
							child_tool_call_ids: [],
							child_operation_ids: [],
							operation_provenance_key: "tool-1",
							operation_state: "completed",
							locations: null,
							skill_meta: null,
							normalized_questions: null,
							question_answer: null,
							awaiting_plan_approval: false,
							plan_approval_request_id: null,
							started_at_ms: null,
							completed_at_ms: null,
							source_link: {
								kind: "transcript_linked",
								entry_id: "tool-1",
							},
							degradation_reason: null,
						},
					],
					interactionPatches: [],
					changedFields: ["operations"],
				},
			})
		);

		expect(result).toMatchObject({
			ok: false,
			kind: "delta",
			maxBytes: getSessionStateEnvelopeByteBudget("delta"),
		});
	});

	it("keeps snapshot budget larger than patch budgets but still bounded", () => {
		expect(getSessionStateEnvelopeByteBudget("snapshot")).toBeGreaterThan(
			getSessionStateEnvelopeByteBudget("plan")
		);
		expect(getSessionStateEnvelopeByteBudget("snapshot")).toBeLessThanOrEqual(2_000_000);
	});
});
