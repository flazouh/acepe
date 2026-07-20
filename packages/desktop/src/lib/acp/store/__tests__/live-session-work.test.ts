import { describe, expect, it } from "bun:test";

import type { LifecycleStatus, SessionGraphActivityKind } from "../../../services/acp-types.js";
import type { ComputerPermissionInteraction } from "../../types/interaction.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ActiveTurnFailure } from "../../types/turn-error.js";
import type { CanonicalSessionProjection } from "../canonical-session-projection.js";
import {
	deriveLiveCanonicalActivity,
	deriveLiveSessionLifecyclePresentation,
	deriveLiveSessionState,
	deriveLiveSessionWorkProjection,
	inactiveSessionWorkSourceFromCanonicalProjection,
	type LiveSessionWorkInput,
	type LiveSessionWorkSource,
	liveSessionWorkSourceFromCanonicalProjection,
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
		activeStreamingTail: null,
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
	readonly canonicalProjection?: CanonicalSessionProjection | null;
	readonly source?: LiveSessionWorkSource;
	readonly currentModeId?: string | null;
	readonly hasPendingQuestion?: boolean;
	readonly pendingComputerPermission?: ComputerPermissionInteraction | null;
	readonly hasUnseenCompletion?: boolean;
	readonly hasLocalPendingSendIntent?: boolean;
}

function makeInput(options: MakeInputOptions = {}): LiveSessionWorkInput {
	const canonicalProjection =
		options.canonicalProjection === undefined
			? makeCanonicalProjection()
			: options.canonicalProjection;
	const source =
		options.source ??
		liveSessionWorkSourceFromCanonicalProjection("session-1", canonicalProjection);
	const pendingQuestion = options.hasPendingQuestion
		? {
				id: "question-1",
				sessionId: "session-1",
				questions: [],
			}
		: null;

	return {
		source,
		currentModeId: options.currentModeId ?? null,
		interactionSnapshot: {
			pendingQuestion,
			pendingPlanApproval: null,
			pendingComputerPermission: options.pendingComputerPermission ?? null,
			pendingPermission: null,
		},
		hasUnseenCompletion: options.hasUnseenCompletion ?? false,
		hasLocalPendingSendIntent: options.hasLocalPendingSendIntent ?? false,
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

	it("does not promote canonical idle from runtime thinking details", () => {
		const state = deriveLiveSessionState(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
			})
		);

		expect(state.connection).toBe("connected");
		expect(state.activity.kind).toBe("idle");
	});

	it("does not promote canonical idle from live tool-call presence", () => {
		const state = deriveLiveSessionState(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
				currentModeId: "plan",
			})
		);

		expect(state.activity.kind).toBe("idle");
	});

	it("does not attach local tool objects to canonical running activity", () => {
		const state = deriveLiveSessionState(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "running_operation"),
				currentModeId: "plan",
			})
		);

		expect(state.activity.kind).toBe("streaming");
		if (state.activity.kind !== "streaming") {
			throw new Error("Expected streaming activity");
		}
		expect(state.activity.tool).toBeNull();
	});

	it("ignores stale pending interaction objects unless canonical activity waits for user", () => {
		const state = deriveLiveSessionState(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
				hasPendingQuestion: true,
			})
		);

		expect(state.pendingInput.kind).toBe("none");
	});

	it("uses interaction graph input when canonical activity waits for user", () => {
		const state = deriveLiveSessionState(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "waiting_for_user"),
				hasPendingQuestion: true,
			})
		);

		expect(state.pendingInput.kind).toBe("question");
	});

	it("uses computer permission input when canonical activity waits for user", () => {
		const computerPermission: ComputerPermissionInteraction = {
			id: "computer-permission-1",
			kind: "computer_permission",
			sessionId: "session-1",
			permissionKind: "accessibility",
			reason: "Accessibility permission is required.",
			status: "pending",
			canonicalOperationId: "op-1",
		};
		const state = deriveLiveSessionState(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "waiting_for_user"),
				pendingComputerPermission: computerPermission,
			})
		);

		expect(state.pendingInput.kind).toBe("computer_permission");
		if (state.pendingInput.kind !== "computer_permission") {
			throw new Error("Expected computer permission pending input");
		}
		expect(state.pendingInput.request).toBe(computerPermission);
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

	it("keeps canonical idle even when runtime reports thinking", () => {
		const canonicalActivity = deriveLiveCanonicalActivity(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
			})
		);

		expect(canonicalActivity).toBe("idle");
	});

	it("keeps canonical idle even when interaction snapshot has a pending question", () => {
		const canonicalActivity = deriveLiveCanonicalActivity(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
				hasPendingQuestion: true,
			})
		);

		expect(canonicalActivity).toBe("idle");
	});

	it("keeps canonical idle even when a tool call is streaming locally", () => {
		const canonicalActivity = deriveLiveCanonicalActivity(
			makeInput({
				canonicalProjection: makeCanonicalProjection("ready", "idle"),
			})
		);

		expect(canonicalActivity).toBe("idle");
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
				source: { kind: "no_session" },
				hasPendingQuestion: true,
			})
		);

		expect(canonicalActivity).toBe("idle");
	});

	it("fails visible when a real session has no canonical projection", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				source: {
					kind: "missing_canonical",
					sessionId: "session-1",
				},
				hasPendingQuestion: true,
			})
		);

		expect(projection.hasError).toBe(true);
		expect(projection.state.connection).toBe("error");
		expect(projection.canonicalActivity).toBe("error");
		expect(selectSessionStatusForPresentation(projection)).toBe("error");
	});

	it("keeps pending-send missing canonical rows connecting instead of erroring", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				source: {
					kind: "missing_canonical",
					sessionId: "session-1",
				},
				hasLocalPendingSendIntent: true,
			})
		);

		expect(projection.hasError).toBe(false);
		expect(projection.state.connection).toBe("connecting");
		expect(projection.canonicalActivity).toBe("idle");
		expect(selectSessionStatusForPresentation(projection)).toBe("connecting");
	});

	it("keeps inactive history sessions neutral when no canonical projection is loaded", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				source: inactiveSessionWorkSourceFromCanonicalProjection("session-1", null),
				hasPendingQuestion: true,
			})
		);

		expect(projection.hasError).toBe(false);
		expect(projection.state.connection).toBe("disconnected");
		expect(projection.canonicalActivity).toBe("idle");
		expect(selectSessionStatusForPresentation(projection)).toBe("idle");
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
				source: { kind: "no_session" },
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
				source: { kind: "no_session" },
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

	it("does not surface a stale lifecycle error message while reconnecting", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				canonicalProjection: makeCanonicalProjection(
					"reconnecting",
					"idle",
					"Previous connection failed"
				),
			})
		);

		expect(projection.hasError).toBe(false);
		expect(projection.state.connection).toBe("connecting");
		expect(projection.canonicalActivity).toBe("idle");
		expect(selectSessionStatusForPresentation(projection)).toBe("connecting");
	});

	it("does not surface a stale lifecycle error message while detached", () => {
		const projection = deriveLiveSessionWorkProjection(
			makeInput({
				canonicalProjection: makeCanonicalProjection(
					"detached",
					"idle",
					"Previous connection failed"
				),
			})
		);

		expect(projection.hasError).toBe(false);
		expect(projection.state.connection).toBe("disconnected");
		expect(projection.canonicalActivity).toBe("idle");
		expect(selectSessionStatusForPresentation(projection)).toBe("idle");
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

describe("deriveLiveSessionLifecyclePresentation", () => {
	it("derives ready empty presentation from canonical lifecycle", () => {
		const presentation = deriveLiveSessionLifecyclePresentation({
			source: {
				kind: "canonical",
				projection: makeCanonicalProjection("ready", "idle"),
			},
			hasEntries: false,
			hasLocalPendingSendIntent: false,
		});

		expect(presentation).toEqual({
			connectionPhase: "connected",
			contentPhase: "empty",
			activityPhase: "idle",
			canSubmit: true,
			canCancel: false,
			showStop: false,
			showThinking: false,
			showConnectingOverlay: false,
			showConversation: false,
			showReadyPlaceholder: true,
		});
	});

	it("keeps pending local send as a submit affordance only", () => {
		const presentation = deriveLiveSessionLifecyclePresentation({
			source: {
				kind: "canonical",
				projection: makeCanonicalProjection("ready", "idle"),
			},
			hasEntries: false,
			hasLocalPendingSendIntent: true,
		});

		expect(presentation.canSubmit).toBe(false);
		expect(presentation.activityPhase).toBe("idle");
		expect(presentation.showThinking).toBe(false);
		expect(presentation.showReadyPlaceholder).toBe(true);
	});

	it("keeps unknown canonical transcript presence distinct from empty transcript", () => {
		const presentation = deriveLiveSessionLifecyclePresentation({
			source: {
				kind: "canonical",
				projection: makeCanonicalProjection("ready", "idle"),
			},
			hasEntries: null,
			hasLocalPendingSendIntent: false,
		});

		expect(presentation).toMatchObject({
			connectionPhase: "connected",
			contentPhase: "loading",
			showConversation: false,
			showReadyPlaceholder: false,
		});
	});

	it("maps canonical activity to runtime-shaped presentation without machine state", () => {
		const awaitingModel = deriveLiveSessionLifecyclePresentation({
			source: {
				kind: "canonical",
				projection: makeCanonicalProjection("ready", "awaiting_model"),
			},
			hasEntries: true,
			hasLocalPendingSendIntent: false,
		});
		const runningOperation = deriveLiveSessionLifecyclePresentation({
			source: {
				kind: "canonical",
				projection: makeCanonicalProjection("ready", "running_operation"),
			},
			hasEntries: true,
			hasLocalPendingSendIntent: false,
		});

		expect(awaitingModel).toMatchObject({
			contentPhase: "loaded",
			activityPhase: "waiting_for_user",
			canCancel: true,
			showStop: true,
			showThinking: true,
			showConversation: true,
			showReadyPlaceholder: false,
		});
		expect(runningOperation).toMatchObject({
			activityPhase: "running",
			canCancel: true,
			showStop: true,
			showThinking: false,
		});
	});

	it("fails closed while canonical projection is absent", () => {
		const presentation = deriveLiveSessionLifecyclePresentation({
			source: { kind: "no_session" },
			hasEntries: false,
			hasLocalPendingSendIntent: false,
		});

		expect(presentation).toMatchObject({
			connectionPhase: "disconnected",
			contentPhase: "empty",
			activityPhase: "idle",
			canSubmit: false,
			showConversation: false,
			showReadyPlaceholder: false,
		});
	});

	it("preserves unknown submit actionability for real sessions without canonical projection", () => {
		const presentation = deriveLiveSessionLifecyclePresentation({
			source: {
				kind: "missing_canonical",
				sessionId: "session-1",
			},
			hasEntries: null,
			hasLocalPendingSendIntent: false,
		});

		expect(presentation).toMatchObject({
			connectionPhase: "failed",
			contentPhase: "loading",
			canSubmit: null,
		});
	});

	it("treats a newly spawned session without canonical projection as connecting while a send is pending", () => {
		const presentation = deriveLiveSessionLifecyclePresentation({
			source: {
				kind: "missing_canonical",
				sessionId: "session-1",
			},
			hasEntries: null,
			hasLocalPendingSendIntent: true,
		});

		expect(presentation).toMatchObject({
			connectionPhase: "connecting",
			contentPhase: "loading",
			canSubmit: null,
		});
	});

	it("keeps inactive history presentation disconnected while canonical projection is unloaded", () => {
		const presentation = deriveLiveSessionLifecyclePresentation({
			source: inactiveSessionWorkSourceFromCanonicalProjection("session-1", null),
			hasEntries: null,
			hasLocalPendingSendIntent: false,
		});

		expect(presentation).toMatchObject({
			connectionPhase: "disconnected",
			contentPhase: "loading",
			canSubmit: false,
		});
	});
});
