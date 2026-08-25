import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SessionOpenFound, SessionStateGraph } from "../../../services/acp-types.js";
import type { CanonicalSessionProjection } from "../canonical-session-projection.js";
import { SessionOpenSnapshotApplier } from "../session-open-snapshot-applier.svelte.js";

// Reproduces the transcript-row-wipe bug at its real seam: a `SessionOpenFound`
// payload (e.g. the session-creation RPC's `sessionOpen` result under
// Electrobun, see session-connection-facade.ts's `hydrateCreatedSession` call)
// resolving *after* the live canonical graph has already advanced past it
// (e.g. OrchestrationCanonicalBridge streamed real transcript deltas for the
// same session in the meantime) must never regress the already-applied,
// more-current transcript back to the stale/empty snapshot it was captured
// with.

function createFoundResult(overrides?: Partial<SessionOpenFound>): SessionOpenFound {
	const requestedSessionId = overrides?.requestedSessionId ?? "requested-session";
	const canonicalSessionId = overrides?.canonicalSessionId ?? "canonical-session";
	const lastEventSeq = overrides?.lastEventSeq ?? 0;
	const graphRevision = overrides?.graphRevision ?? lastEventSeq;
	const transcriptSnapshot = overrides?.transcriptSnapshot ?? {
		revision: 0,
		entries: [],
	};
	return {
		requestedSessionId,
		canonicalSessionId,
		isAlias: overrides?.isAlias ?? false,
		openPath: overrides?.openPath ?? "legacy_rebuild",
		lastEventSeq,
		graphRevision,
		openToken: overrides?.openToken ?? "open-token",
		agentId: overrides?.agentId ?? "claude-code",
		projectPath: overrides?.projectPath ?? "/repo",
		worktreePath: overrides?.worktreePath ?? null,
		sourcePath: overrides?.sourcePath ?? null,
		sequenceId: overrides?.sequenceId ?? null,
		transcriptSnapshot,
		sessionTitle: overrides?.sessionTitle ?? "New Thread",
		operations: overrides?.operations ?? [],
		interactions: overrides?.interactions ?? [],
		turnState: overrides?.turnState ?? "Idle",
		messageCount: overrides?.messageCount ?? 0,
		activity: overrides?.activity ?? {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		activeStreamingTail: overrides?.activeStreamingTail ?? null,
		lifecycle: overrides?.lifecycle ?? {
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
		},
		capabilities: overrides?.capabilities ?? {},
		initialTranscriptRowPage: overrides?.initialTranscriptRowPage ?? null,
		initialViewportEnvelope: overrides?.initialViewportEnvelope ?? null,
		activeTurnFailure: overrides?.activeTurnFailure ?? null,
		lastTerminalTurnId: overrides?.lastTerminalTurnId ?? null,
	};
}

function createLiveProjection(
	overrides?: Partial<CanonicalSessionProjection>
): CanonicalSessionProjection {
	return {
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
		},
		activity: {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		turnState: "Completed",
		activeTurnFailure: null,
		lastTerminalTurnId: "turn-1",
		activeStreamingTail: null,
		capabilities: {
			models: null,
			modes: null,
			availableCommands: null,
			configOptions: null,
			autonomousEnabled: null,
		},
		revision: {
			graphRevision: 5,
			transcriptRevision: 5,
			lastEventSeq: 5,
		},
		...overrides,
	};
}

describe("SessionOpenSnapshotApplier", () => {
	let replaceSessionOperations: ReturnType<typeof mock>;
	let replaceTranscriptSnapshot: ReturnType<typeof mock>;
	let setSessionStateGraph: ReturnType<typeof mock>;
	let setCanonicalProjection: ReturnType<typeof mock>;
	let setCapabilitiesMaterialized: ReturnType<typeof mock>;
	let updateTransientProjection: ReturnType<typeof mock>;
	let initializeTransientProjection: ReturnType<typeof mock>;
	let sendContentLoad: ReturnType<typeof mock>;
	let sendContentLoaded: ReturnType<typeof mock>;
	let getCanonicalProjection: ReturnType<typeof mock>;
	let getSessionStateGraph: ReturnType<typeof mock>;
	let applier: SessionOpenSnapshotApplier;

	beforeEach(() => {
		replaceSessionOperations = mock(() => {});
		replaceTranscriptSnapshot = mock(() => {});
		setSessionStateGraph = mock(() => {});
		setCanonicalProjection = mock(() => {});
		setCapabilitiesMaterialized = mock(() => {});
		updateTransientProjection = mock(() => {});
		initializeTransientProjection = mock(() => {});
		sendContentLoad = mock(() => {});
		sendContentLoaded = mock(() => {});
		getCanonicalProjection = mock(() => null as CanonicalSessionProjection | null);
		getSessionStateGraph = mock(() => null as SessionStateGraph | null);

		applier = new SessionOpenSnapshotApplier({
			listState: { applyOpenSnapshotToList: mock(() => {}) } as never,
			creationCoordinator: {} as never,
			getSessionIdentity: () => undefined,
			getSessionMetadata: () => undefined,
			addSession: mock(() => {}),
			removeSession: mock(() => {}),
			removeOptimisticSession: mock(() => {}),
			updateSession: mock(() => {}),
			replaceSessionOperations,
			replaceTranscriptSnapshot,
			initializeTransientProjection,
			updateTransientProjection,
			setSessionStateGraph,
			setCanonicalProjection,
			setCapabilitiesMaterialized,
			getCanonicalProjection,
			getSessionStateGraph,
			sendContentLoad,
			sendContentLoaded,
			recordAliasRelationship: mock(() => {}),
			migratePendingSendIntentAlias: mock(() => {}),
		});
	});

	it("does not wipe an already-advanced live transcript with a stale open snapshot", () => {
		// The live canonical graph already carries real transcript entries at
		// revision 5 (e.g. OrchestrationCanonicalBridge already streamed the
		// user message + assistant reply). A `SessionOpenFound` captured at
		// session-creation time (revision 0, empty transcript) resolving late
		// must not be allowed to replace it.
		getCanonicalProjection.mockImplementation(() => createLiveProjection());
		const staleSnapshot = createFoundResult({
			graphRevision: 0,
			lastEventSeq: 0,
			transcriptSnapshot: { revision: 0, entries: [] },
		});

		applier.replaceSessionOpenSnapshot(staleSnapshot);

		expect(setSessionStateGraph).not.toHaveBeenCalled();
		expect(replaceTranscriptSnapshot).not.toHaveBeenCalled();
		expect(replaceSessionOperations).not.toHaveBeenCalled();
		expect(setCanonicalProjection).not.toHaveBeenCalled();
		// Hydration bookkeeping (loading-state signals, transient projection
		// init) must still run so the panel doesn't get stuck loading.
		expect(initializeTransientProjection).toHaveBeenCalledTimes(1);
		expect(sendContentLoad).toHaveBeenCalledTimes(1);
		expect(sendContentLoaded).toHaveBeenCalledTimes(1);
	});

	it("applies a genuinely newer open snapshot over the live graph", () => {
		getCanonicalProjection.mockImplementation(() => createLiveProjection());
		const newerSnapshot = createFoundResult({
			graphRevision: 9,
			lastEventSeq: 9,
			transcriptSnapshot: { revision: 9, entries: [] },
		});

		applier.replaceSessionOpenSnapshot(newerSnapshot);

		expect(setSessionStateGraph).toHaveBeenCalledTimes(1);
		expect(replaceTranscriptSnapshot).toHaveBeenCalledTimes(1);
		expect(setCanonicalProjection).toHaveBeenCalledTimes(1);
	});

	it("applies the first open snapshot when no live graph exists yet", () => {
		// Real first-hydration path (fresh session open / cold-restart reopen):
		// no canonical projection or graph exists yet, so the snapshot must
		// apply unconditionally.
		getCanonicalProjection.mockImplementation(() => null);
		getSessionStateGraph.mockImplementation(() => null);
		const firstSnapshot = createFoundResult({
			graphRevision: 0,
			lastEventSeq: 0,
			transcriptSnapshot: { revision: 0, entries: [] },
		});

		applier.replaceSessionOpenSnapshot(firstSnapshot);

		expect(setSessionStateGraph).toHaveBeenCalledTimes(1);
		expect(replaceTranscriptSnapshot).toHaveBeenCalledTimes(1);
		expect(setCanonicalProjection).toHaveBeenCalledTimes(1);
	});
});
