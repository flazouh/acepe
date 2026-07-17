import { describe, expect, it, vi } from "vitest";
import { okAsync } from "neverthrow";
import type { SessionStateGraph } from "../../../services/acp-types.js";
import { SessionEnvelopeApplier } from "../session-envelope-applier.svelte.js";

function createMinimalGraph(sessionId: string): SessionStateGraph {
	return {
		requestedSessionId: sessionId,
		canonicalSessionId: sessionId,
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/tmp/project",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
		transcriptSnapshot: { revision: 1, entries: [] },
		operations: [],
		interactions: [],
		turnState: "Completed",
		messageCount: 0,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: "turn-1",
		lifecycle: {
			status: "ready",
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
			failureReason: null,
			errorMessage: null,
			detachedReason: null,
		},
		activity: {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		capabilities: {
			models: null,
			modes: null,
			availableCommands: null,
			configOptions: null,
			autonomousEnabled: null,
		},
	};
}

describe("SessionEnvelopeApplier", () => {
	it("materializes canonical projection maps through accessor deps", () => {
		const setCanonicalProjection = vi.fn();
		const setSessionStateGraph = vi.fn();
		const setCapabilitiesMaterialized = vi.fn();
		const updateTransientProjection = vi.fn();
		const reconcileConnectionMachine = vi.fn();

		const applier = new SessionEnvelopeApplier({
			getCallbacks: () => ({}),
			getSessionIdentity: () => ({
				id: "session-1",
				projectPath: "/tmp/project",
				agentId: "claude-code",
			}),
			getGraphRevision: () => undefined,
			getCanonicalProjection: () => null,
			getSessionStateGraph: () => null,
			getCapabilitiesMaterialized: () => false,
			getTransientProjection: () => ({
				acpSessionId: null,
				autonomousTransition: "idle",
				statusChangedAt: 0,
				capabilityMutationState: {
					pendingMutationId: null,
					previewState: null,
				},
				modelPerMode: new Map(),
				usageTelemetry: undefined,
				pendingSendIntent: null,
				localPersistedSessionProbeStatus: null,
			}),
			getSessionCurrentModelId: () => null,
			getSessionCold: () => undefined,
			setCapabilitiesMaterialized,
			setCanonicalProjection,
			setSessionStateGraph,
			updateTransientProjection,
			updateUsageTelemetry: vi.fn(),
			applyViewportBufferPush: vi.fn(),
			applyViewportBufferDelta: vi.fn(),
			replaceSessionOperations: vi.fn(),
			replaceTranscriptSnapshot: vi.fn(),
			applyTranscriptDeltaToEntryStore: vi.fn(),
			applySessionOperationPatches: vi.fn(),
			replaceLiveSessionStateGraph: vi.fn(),
			applyLiveSessionInteractionPatches: vi.fn(),
			syncAwaitingModelRefreshTimer: vi.fn(),
			reconcileConnectionMachine,
			syncSessionSequenceFromGraph: vi.fn(),
			composerEndDispatch: vi.fn(),
			handleCanonicalTurnComplete: vi.fn(),
			handleCanonicalTurnFailure: vi.fn(),
			refreshSessionStateSnapshot: vi.fn(() => okAsync(undefined)),
		});

		const graph = createMinimalGraph("session-1");
		applier.applySessionStateGraph(graph);

		expect(setSessionStateGraph).toHaveBeenCalledWith("session-1", graph);
		expect(setCapabilitiesMaterialized).toHaveBeenCalledWith("session-1", true);
		expect(setCanonicalProjection).toHaveBeenCalledOnce();
		expect(updateTransientProjection).toHaveBeenCalledOnce();
		expect(reconcileConnectionMachine).toHaveBeenCalledOnce();
	});
});
