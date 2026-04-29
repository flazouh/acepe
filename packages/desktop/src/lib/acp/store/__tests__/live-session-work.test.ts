import { describe, expect, it } from "bun:test";

import type {
	LifecycleStatus,
	SessionGraphActivityKind,
} from "../../../services/acp-types.js";
import type { SessionRuntimeState } from "../../logic/session-ui-state.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ActiveTurnFailure } from "../../types/turn-error.js";
import type { CanonicalSessionProjection } from "../canonical-session-projection.js";
import {
	deriveLiveCanonicalActivity,
	deriveLiveSessionState,
	deriveLiveSessionWorkProjection,
	type LiveSessionWorkInput,
} from "../live-session-work.js";
import { selectSessionStatusForPresentation } from "../session-work-projection.js";

function makeToolCall(): ToolCall {
	return {
		id: "tool-1",
		name: "task",
		arguments: { kind: "other", raw: {} },
		status: "pending",
		kind: "other",
		awaitingPlanApproval: false,
	};
}

function makeRuntimeState(
	activityPhase: SessionRuntimeState["activityPhase"],
	showThinking: boolean = false
): SessionRuntimeState {
	return {
		connectionPhase: "connected",
		contentPhase: "loaded",
		activityPhase,
		canSubmit: activityPhase === "idle",
		canCancel: activityPhase !== "idle",
		showStop: activityPhase !== "idle",
		showThinking,
		showConnectingOverlay: false,
		showConversation: true,
		showReadyPlaceholder: false,
	};
}

function makeActiveTurnFailure(message: string): ActiveTurnFailure {
	return {
		turnId: "turn-1",
		kind: "recoverable",
		message,
		code: null,
		source: "unknown",
	};
}

function makeCanonicalProjection(
	status: LifecycleStatus = "ready",
	activityKind: SessionGraphActivityKind = "idle",
	errorMessage: string | null = null,
	activeTurnFailure: ActiveTurnFailure | null = null
): CanonicalSessionProjection {
	return {
		lifecycle: {
			status,
			errorMessage,
			detachedReason: null,
			failureReason: null,
			actionability: {
				canSend: status === "ready",
				canResume: status === "detached",
				canRetry: status === "failed",
				canArchive: true,
				canConfigure: status === "ready",
				recommendedAction: status === "ready" ? "send" : "wait",
				recoveryPhase: "none",
				compactStatus: status,
			},
		},
		activity: {
			kind: activityKind,
			activeOperationCount: activityKind === "running_operation" ? 1 : 0,
			activeSubagentCount: 0,
			dominantOperationId: activityKind === "running_operation" ? "op-1" : null,
			blockingInteractionId: null,
		},
		turnState: activityKind === "idle" ? "Idle" : "Running",
		activeTurnFailure,
		lastTerminalTurnId: null,
		capabilities: {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
		revision: {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
	};
}

interface MakeInputOptions {
	readonly runtimeState?: SessionRuntimeState | null;
	readonly canonicalProjection?: LiveSessionWorkInput["canonicalProjection"];
	readonly currentModeId?: string | null;
	readonly currentStreamingToolCall?: ToolCall | null;
	readonly hasPendingQuestion?: boolean;
	readonly hasUnseenCompletion?: boolean;
}

function makeInput(options: MakeInputOptions = {}): LiveSessionWorkInput {
	const canonicalProjection =
		options.canonicalProjection === undefined
			? makeCanonicalProjection()
			: options.canonicalProjection;
	const pendingQuestion = options.hasPendingQuestion
		? {
				id: "question-1",
				sessionId: "session-1",
				questions: [],
			}
		: null;

	return {
		runtimeState: options.runtimeState ?? null,
		canonicalProjection,
		currentModeId: options.currentModeId ?? null,
		currentStreamingToolCall: options.currentStreamingToolCall ?? null,
		interactionSnapshot: {
			pendingQuestion,
			pendingPlanApproval: null,
			pendingPermission: null,
		},
		hasUnseenCompletion: options.hasUnseenCompletion ?? false,
	};
}

describe("deriveLiveSessionState", () => {
	it("maps canonical lifecycle phases to session connection phases", () => {
		const cases: ReadonlyArray<{
			readonly status: LifecycleStatus;
			readonly expectedConnection: ReturnType<typeof deriveLiveSessionState>["connection"];
		}> = [
			{ status: "reserved", expectedConnection: "disconnected" },
			{ status: "activating", expectedConnection: "connecting" },
			{ status: "ready", expectedConnection: "connected" },
			{ status: "reconnecting", expectedConnection: "connecting" },
			{ status: "detached", expectedConnection: "disconnected" },
			{ status: "failed", expectedConnection: "error" },
			{ status: "archived", expectedConnection: "disconnected" },
		];

		for (const testCase of cases) {
			const state = deriveLiveSessionState(
				makeInput({
					canonicalProjection: makeCanonicalProjection(testCase.status, "idle"),
				})
			);

			expect(state.connection).toBe(testCase.expectedConnection);
		}
	});

	it("uses runtime thinking details only after canonical projection is present", () => {
		const state = deriveLiveSessionState(
			makeInput({
				runtimeState: makeRuntimeState("running", true),
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
			})
		);

		expect(state.connection).toBe("connected");
		expect(state.activity.kind).toBe("thinking");
	});

	it("keeps current mode id from canonical-derived input", () => {
		const state = deriveLiveSessionState(
			makeInput({
				runtimeState: makeRuntimeState("running"),
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
				currentModeId: "plan",
				currentStreamingToolCall: makeToolCall(),
			})
		);

		expect(state.activity.kind).toBe("streaming");
		if (state.activity.kind === "streaming") {
			expect(state.activity.modeId).toBe("plan");
		}
	});
});

describe("deriveLiveCanonicalActivity", () => {
	it("returns canonical graph activity for every graph activity kind", () => {
		const cases: ReadonlyArray<{
			readonly kind: SessionGraphActivityKind;
			readonly expected: ReturnType<typeof deriveLiveCanonicalActivity>;
		}> = [
			{ kind: "awaiting_model", expected: "awaiting_model" },
			{ kind: "running_operation", expected: "running_operation" },
			{ kind: "waiting_for_user", expected: "waiting_for_user" },
			{ kind: "paused", expected: "paused" },
			{ kind: "error", expected: "error" },
			{ kind: "idle", expected: "idle" },
		];

		for (const testCase of cases) {
			const canonicalActivity = deriveLiveCanonicalActivity(
				makeInput({
					canonicalProjection: makeCanonicalProjection("ready", testCase.kind),
				})
			);

			expect(canonicalActivity).toBe(testCase.expected);
		}
	});

	it("lets live streaming work override stale idle canonical projection activity", () => {
		const canonicalActivity = deriveLiveCanonicalActivity(
			makeInput({
				runtimeState: makeRuntimeState("running", true),
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
			})
		);

		expect(canonicalActivity).toBe("awaiting_model");
	});

	it("keeps pending interaction dominant when canonical activity is idle", () => {
		const canonicalActivity = deriveLiveCanonicalActivity(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
				hasPendingQuestion: true,
			})
		);

		expect(canonicalActivity).toBe("waiting_for_user");
	});

	it("keeps active tool work dominant when canonical activity is idle", () => {
		const canonicalActivity = deriveLiveCanonicalActivity(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
				currentStreamingToolCall: makeToolCall(),
			})
		);

		expect(canonicalActivity).toBe("running_operation");
	});

	it("treats canonical activeTurnFailure as authoritative", () => {
		const canonicalActivity = deriveLiveCanonicalActivity(
			makeInput({
				canonicalProjection: makeCanonicalProjection(
					"ready",
					"idle",
					null,
					makeActiveTurnFailure("boom")
				),
			})
		);

		expect(canonicalActivity).toBe("error");
	});

	it("returns neutral idle activity while canonical projection is absent", () => {
		const canonicalActivity = deriveLiveCanonicalActivity(
			makeInput({
				runtimeState: makeRuntimeState("running", true),
				canonicalProjection: null,
				currentStreamingToolCall: makeToolCall(),
				hasPendingQuestion: true,
			})
		);

		expect(canonicalActivity).toBe("idle");
	});
});

describe("deriveLiveSessionWorkProjection", () => {
	it("keeps graph-backed planning visible while a reserved session activates", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				canonicalProjection: makeCanonicalProjection("reserved", "awaiting_model"),
			})
		);

		expect(projection.state.connection).toBe("connected");
		expect(projection.state.activity.kind).toBe("thinking");
		expect(projection.compactActivityKind).toBe("thinking");
		expect(selectSessionStatusForPresentation(projection)).toBe("streaming");
	});

	it("maps canonical paused activity to paused presentation", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "paused"),
			})
		);

		expect(projection.state.activity.kind).toBe("paused");
		expect(projection.compactActivityKind).toBe("paused");
		expect(selectSessionStatusForPresentation(projection)).toBe("paused");
	});

	it("stays neutral before the first canonical projection arrives", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				runtimeState: makeRuntimeState("running", true),
				canonicalProjection: null,
				currentStreamingToolCall: makeToolCall(),
				hasPendingQuestion: true,
			})
		);

		expect(projection.state.connection).toBe("disconnected");
		expect(projection.state.activity.kind).toBe("idle");
		expect(projection.canonicalActivity).toBe("idle");
		expect(selectSessionStatusForPresentation(projection)).toBe("idle");
	});

	it("transitions from neutral null canonical state to canonical failure", () => {
		const neutralProjection = deriveLiveSessionWorkProjection(
			makeInput({
				canonicalProjection: null,
			})
		);
		const failedProjection = deriveLiveSessionWorkProjection(
			makeInput({
				canonicalProjection: makeCanonicalProjection("failed", "idle", "Resume failed"),
			})
		);

		expect(selectSessionStatusForPresentation(neutralProjection)).toBe("idle");
		expect(failedProjection.hasError).toBe(true);
		expect(failedProjection.canonicalActivity).toBe("error");
		expect(selectSessionStatusForPresentation(failedProjection)).toBe("error");
	});

	it("surfaces canonical active turn failures", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				canonicalProjection: makeCanonicalProjection(
					"ready",
					"idle",
					null,
					makeActiveTurnFailure("turn failed")
				),
			})
		);

		expect(projection.hasError).toBe(true);
		expect(projection.canonicalActivity).toBe("error");
		expect(selectSessionStatusForPresentation(projection)).toBe("error");
	});
});
