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
		});

		expect(runtime.turnState).toBe("streaming");
		expect(runtime.isStreaming).toBe(true);
	});

	it("produces idle turn state from no_session source", () => {
		const runtime = resolveAgentPanelContentRuntime({
			liveSessionSource: { kind: "no_session" },
		});

		expect(runtime.turnState).toBe("idle");
		expect(runtime.isStreaming).toBe(false);
	});

	it("produces error turn state when canonical data is missing", () => {
		const runtime = resolveAgentPanelContentRuntime({
			liveSessionSource: { kind: "missing_canonical", sessionId: "session-1" },
		});

		expect(runtime.turnState).toBe("error");
		expect(runtime.isStreaming).toBe(false);
	});
});
