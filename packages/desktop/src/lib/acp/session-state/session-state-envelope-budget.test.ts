import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionStateEnvelope, SessionStateGraph } from "../../services/acp-types.js";
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

function createLifecycle(errorMessage: string | null = null) {
	return {
		status: "ready" as const,
		detachedReason: null,
		failureReason: null,
		errorMessage,
		actionability: {
			canSend: true,
			canResume: false,
			canRetry: false,
			canArchive: true,
			canConfigure: true,
			recommendedAction: "send" as const,
			recoveryPhase: "none" as const,
			compactStatus: "ready" as const,
		},
	};
}

function createCapabilities(description = "Describe the command") {
	return {
		availableCommands: [
			{
				name: "plan",
				description,
			},
		],
		autonomousEnabled: true,
	};
}

function createLargeCommandCatalog() {
	return {
		availableCommands: Array.from({ length: 118 }, (_, index) => ({
			name: `command-${index}`,
			description:
				"Provider command description with enough text to match a real Claude Code catalog entry.",
		})),
		autonomousEnabled: true,
	};
}

function createTelemetry(sourceModelId = "claude-sonnet") {
	return {
		sessionId: "session-1",
		eventId: "event-1",
		scope: "step",
		costUsd: 0.02,
		tokens: {
			total: 42,
			input: 20,
			output: 22,
		},
		sourceModelId,
		timestampMs: 123,
		contextWindowSize: 200_000,
	};
}

function createPlan(contentMarkdown: string | null = "## Plan") {
	return {
		steps: [
			{
				description: "Inspect the current state",
				status: "completed" as const,
			},
			{
				description: "Apply a small patch",
				status: "in_progress" as const,
			},
		],
		currentStep: 1,
		hasPlan: true,
		contentMarkdown,
		title: "Plan",
		source: "deterministic" as const,
		confidence: "high" as const,
		agentId: "agent-1",
		updatedAt: 123,
	};
}

function createVisibleTranscriptWindow(rowCount: number, textSize: number) {
	return {
		sessionId: "session-1",
		graphRevision: revision,
		viewportRevision: 1,
		totalHeightPx: rowCount * 120,
		viewportOffsetPx: Math.max(0, rowCount * 120 - 720),
		visibleStartIndex: 0,
		visibleEndIndex: rowCount,
		rows: Array.from({ length: rowCount }, (_, index) => ({
			rowId: `transcript:assistant-${index}`,
			sourceEntryId: `assistant-${index}`,
			kind: "assistantText" as const,
			version: `v-${index}`,
			anchorEligible: true,
			activeStreamingTail: null,
			operationLinks: [],
			interactionLinks: [],
			content: {
				kind: "transcript" as const,
				role: "assistant" as const,
				segments: [
					{
						kind: "text" as const,
						segmentId: `assistant-${index}:text`,
						text: "x".repeat(textSize),
					},
				],
			},
		})),
		rowOffsetsPx: Array.from({ length: rowCount }, (_, index) => index * 120),
		mode: {
			kind: "followingTail" as const,
		},
		diagnostics: [],
	};
}

function createSnapshotGraph(assistantText = "Hello"): SessionStateGraph {
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "agent-1" as SessionStateGraph["agentId"],
		projectPath: "/tmp/project",
		worktreePath: null,
		sourcePath: null,
		revision,
		transcriptSnapshot: {
			revision: 1,
			entries: [
				{
					entryId: "assistant-1",
					role: "assistant",
					segments: [
						{
							kind: "text",
							segmentId: "segment-1",
							text: assistantText,
						},
					],
				},
			],
		},
		operations: [],
		interactions: [],
		turnState: "Idle",
		messageCount: 1,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle: createLifecycle(),
		activity: idleActivity,
		capabilities: createCapabilities(),
	};
}

describe("session-state envelope byte budgets", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("defines a byte budget for every session-state payload kind", () => {
		expect(SESSION_STATE_ENVELOPE_BYTE_BUDGETS.map((budget) => budget.kind).sort()).toEqual([
			"assistantTextDelta",
			"capabilities",
			"delta",
			"lifecycle",
			"plan",
			"snapshot",
			"telemetry",
			"viewportBufferDelta",
			"viewportBufferPush",
			"visibleTranscriptWindow",
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

	it("keeps visible-window budget below snapshot budget but above tiny token deltas", () => {
		expect(getSessionStateEnvelopeByteBudget("visibleTranscriptWindow")).toBeLessThan(
			getSessionStateEnvelopeByteBudget("snapshot")
		);
		expect(getSessionStateEnvelopeByteBudget("visibleTranscriptWindow")).toBeGreaterThan(
			getSessionStateEnvelopeByteBudget("assistantTextDelta")
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

	it("accepts a bounded visible transcript window", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "visibleTranscriptWindow",
				window: createVisibleTranscriptWindow(24, 40),
			})
		);

		expect(result.ok).toBe(true);
		expect(result.kind).toBe("visibleTranscriptWindow");
	});

	it("rejects full-transcript shaped visible transcript windows", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "visibleTranscriptWindow",
				window: createVisibleTranscriptWindow(2_000, 120),
			})
		);

		expect(result).toMatchObject({
			ok: false,
			kind: "visibleTranscriptWindow",
			maxBytes: getSessionStateEnvelopeByteBudget("visibleTranscriptWindow"),
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

	it("accepts normal small lifecycle envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "lifecycle",
				lifecycle: createLifecycle(),
				revision,
			})
		);

		expect(result).toMatchObject({
			ok: true,
			kind: "lifecycle",
		});
	});

	it("rejects oversized lifecycle envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "lifecycle",
				lifecycle: createLifecycle("x".repeat(getSessionStateEnvelopeByteBudget("lifecycle"))),
				revision,
			})
		);

		expect(result).toMatchObject({
			ok: false,
			kind: "lifecycle",
			maxBytes: getSessionStateEnvelopeByteBudget("lifecycle"),
		});
	});

	it("accepts normal small capabilities envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "capabilities",
				capabilities: createCapabilities(),
				revision,
				preview_state: "canonical",
			})
		);

		expect(result).toMatchObject({
			ok: true,
			kind: "capabilities",
		});
	});

	it("accepts large provider command catalogs in capabilities envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "capabilities",
				capabilities: createLargeCommandCatalog(),
				revision,
				preview_state: "canonical",
			})
		);

		expect(result).toMatchObject({
			ok: true,
			kind: "capabilities",
		});
	});

	it("rejects oversized capabilities envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "capabilities",
				capabilities: createCapabilities(
					"x".repeat(getSessionStateEnvelopeByteBudget("capabilities"))
				),
				revision,
				preview_state: "canonical",
			})
		);

		expect(result).toMatchObject({
			ok: false,
			kind: "capabilities",
			maxBytes: getSessionStateEnvelopeByteBudget("capabilities"),
		});
	});

	it("accepts normal small telemetry envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "telemetry",
				telemetry: createTelemetry(),
				revision,
			})
		);

		expect(result).toMatchObject({
			ok: true,
			kind: "telemetry",
		});
	});

	it("rejects oversized telemetry envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "telemetry",
				telemetry: createTelemetry(
					"x".repeat(getSessionStateEnvelopeByteBudget("telemetry"))
				),
				revision,
			})
		);

		expect(result).toMatchObject({
			ok: false,
			kind: "telemetry",
			maxBytes: getSessionStateEnvelopeByteBudget("telemetry"),
		});
	});

	it("accepts normal small plan envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "plan",
				plan: createPlan(),
				revision,
			})
		);

		expect(result).toMatchObject({
			ok: true,
			kind: "plan",
		});
	});

	it("rejects oversized plan envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "plan",
				plan: createPlan("x".repeat(getSessionStateEnvelopeByteBudget("plan"))),
				revision,
			})
		);

		expect(result).toMatchObject({
			ok: false,
			kind: "plan",
			maxBytes: getSessionStateEnvelopeByteBudget("plan"),
		});
	});

	it("accepts normal small snapshot envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "snapshot",
				graph: createSnapshotGraph(),
			})
		);

		expect(result).toMatchObject({
			ok: true,
			kind: "snapshot",
		});
	});

	it("rejects oversized snapshot envelopes", () => {
		const result = checkSessionStateEnvelopeByteBudget(
			createEnvelope({
				kind: "snapshot",
				graph: createSnapshotGraph(
					"x".repeat(getSessionStateEnvelopeByteBudget("snapshot"))
				),
			})
		);

		expect(result).toMatchObject({
			ok: false,
			kind: "snapshot",
			maxBytes: getSessionStateEnvelopeByteBudget("snapshot"),
		});
	});

	it("memoizes repeated byte-budget checks for the same envelope object", () => {
		const stringifySpy = vi.spyOn(JSON, "stringify");
		const envelope = createEnvelope({
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
		});

		const firstResult = checkSessionStateEnvelopeByteBudget(envelope);
		const secondResult = checkSessionStateEnvelopeByteBudget(envelope);

		expect(secondResult).toBe(firstResult);
		expect(stringifySpy).toHaveBeenCalledTimes(1);
	});
});
