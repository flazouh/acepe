import { describe, expect, it } from "bun:test";
import type { SessionGraphActivityKind } from "../../../../../services/acp-types.js";
import type { LiveSessionCanonicalProjection } from "../../../../store/live-session-work.js";
import { resolveAgentPanelContentRuntime } from "../agent-panel-content-runtime.js";

function createCanonicalProjection(
	activityKind: SessionGraphActivityKind,
	turnState: LiveSessionCanonicalProjection["turnState"] = "Running"
): LiveSessionCanonicalProjection {
	return {
		lifecycle: {
			status: "ready",
			errorMessage: null,
			detachedReason: null,
			failureReason: null,
			actionability: {
				canSend: true,
				canResume: false,
				canRetry: false,
				canArchive: true,
				canConfigure: true,
				recommendedAction: "send",
				recoveryPhase: "none",
				compactStatus: "ready",
			},
		},
		activity: {
			kind: activityKind,
			activeOperationCount: activityKind === "running_operation" ? 1 : 0,
			activeSubagentCount: 0,
			dominantOperationId: activityKind === "running_operation" ? "op-1" : null,
			blockingInteractionId: null,
		},
		turnState,
		activeTurnFailure: null,
	};
}

describe("agent panel content runtime", () => {
	it("maps canonical turn state into viewport streaming state", () => {
		const runtime = resolveAgentPanelContentRuntime({
			liveSessionSource: {
				kind: "canonical",
				projection: createCanonicalProjection("running_operation", "Running"),
			},
			explicitWaiting: undefined,
			sessionWorkProjection: { canonicalActivity: "running_operation" },
		});

		expect(runtime.turnState).toBe("streaming");
		expect(runtime.isStreaming).toBe(true);
		expect(runtime.isWaitingForResponse).toBe(false);
	});

	it("derives waiting only from canonical awaiting-model activity when no explicit prop is passed", () => {
		const runtime = resolveAgentPanelContentRuntime({
			liveSessionSource: {
				kind: "canonical",
				projection: createCanonicalProjection("awaiting_model", "Running"),
			},
			explicitWaiting: undefined,
			sessionWorkProjection: { canonicalActivity: "awaiting_model" },
		});

		expect(runtime.isWaitingForResponse).toBe(true);
	});

	it("lets an explicit waiting prop override canonical activity", () => {
		const runtime = resolveAgentPanelContentRuntime({
			liveSessionSource: {
				kind: "canonical",
				projection: createCanonicalProjection("awaiting_model", "Running"),
			},
			explicitWaiting: false,
			sessionWorkProjection: { canonicalActivity: "awaiting_model" },
		});

		expect(runtime.isWaitingForResponse).toBe(false);
	});

	it("uses an explicit error turn state when canonical data is missing", () => {
		const runtime = resolveAgentPanelContentRuntime({
			liveSessionSource: { kind: "missing_canonical", sessionId: "session-1" },
			explicitWaiting: undefined,
			sessionWorkProjection: null,
		});

		expect(runtime.turnState).toBe("error");
		expect(runtime.isStreaming).toBe(false);
		expect(runtime.isWaitingForResponse).toBe(false);
	});
});
