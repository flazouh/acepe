import { describe, expect, it } from "vitest";
import type { SessionGraphLifecycle } from "$lib/services/acp-types.js";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { AgentPanelSessionController } from "../agent-panel-session-controller.svelte.js";

function lifecycle(
	status: SessionGraphLifecycle["status"],
	canSend = status === "ready"
): SessionGraphLifecycle {
	return {
		status,
		detachedReason: status === "detached" ? "restoredRequiresAttach" : null,
		failureReason: status === "failed" ? "resumeFailed" : null,
		errorMessage: status === "failed" ? "Connection failed" : null,
		actionability: {
			canSend,
			canResume: false,
			canRetry: false,
			canConfigure: canSend,
			canArchive: status !== "archived",
			recommendedAction: canSend ? "send" : "wait",
			recoveryPhase: status === "activating" ? "activating" : "none",
			compactStatus: status,
		},
	};
}

describe("AgentPanelSessionController canonical source binding", () => {
	const stubPanelStore = { getHotState: () => null } as unknown as PanelStore;

	function makeController(
		sessionSource: ReturnType<SessionStore["presentation"]["getSessionAgentPanelSessionSource"]>
	) {
		const sessionStore = {
			presentation: {
				getSessionAgentPanelSessionSource: () => sessionSource,
				getSessionLifecyclePresentation: () => null,
				getSessionAgentPanelCanonicalSource: () => null,
			},
			read: {
				getSessionPendingSendIntent: () => null,
				getSessionTranscriptEntries: () => [{ entryId: "e1", role: "user" }],
				getSessionConnectionError: () => null,
				getSessionLifecycleFailureReason: () => null,
				getSessionActiveTurnFailure: () => null,
				getSessionIdentity: () => null,
				getSessionMetadata: () => null,
				getSessionCurrentModelId: () => null,
			},
		} as unknown as SessionStore;

		return new AgentPanelSessionController({
			getSessionId: () => "session-1",
			getPanelId: () => "panel-1",
			sessionStore,
			panelStore: stubPanelStore,
			getPanelConnectionState: () => null,
			getPanelConnectionError: () => null,
			getAgentName: () => "",
		});
	}

	it("enables submit when canonical lifecycle is ready and canSend is true", () => {
		const controller = makeController({
			kind: "canonical",
			lifecycle: lifecycle("ready", true),
			activity: { kind: "idle", activeOperationCount: 0, activeSubagentCount: 0, dominantOperationId: null, blockingInteractionId: null },
			turnState: "Completed",
		});

		expect(controller.canonicalPanelSessionSource.kind).toBe("canonical");
		expect(controller.sessionCanSubmit).toBe(true);
	});

	it("keeps submit disabled when canonical lifecycle is ready but canSend is false", () => {
		const controller = makeController({
			kind: "canonical",
			lifecycle: lifecycle("ready", false),
			activity: { kind: "idle", activeOperationCount: 0, activeSubagentCount: 0, dominantOperationId: null, blockingInteractionId: null },
			turnState: "Completed",
		});

		expect(controller.sessionCanSubmit).toBe(false);
	});

	it("keeps submit disabled when the canonical projection is missing", () => {
		const controller = makeController({
			kind: "missing_canonical",
			sessionId: "session-1",
		});

		expect(controller.sessionCanSubmit).toBe(false);
	});
});
