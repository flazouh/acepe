/**
 * Session Store - Consolidated session management.
 *
 * Canonical session truth comes from Rust-authored SessionStateGraph envelopes.
 * This store keeps local indexes and projections around that truth:
 * - sessions: SessionCold[] for identity and metadata
 * - sessionStateGraphs/canonicalProjections for lifecycle, activity, turn state, and capabilities
 * - entryStore for canonical transcript snapshot/delta projection
 * - operationStore for canonical tool operation state
 * - transientProjectionStore only for local UI affordances with no canonical counterpart
 */

import { countWordsInMarkdown } from "@acepe/ui/markdown";
import { err, errAsync, ok, okAsync, type Result, type ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type {
	AssistantTextDeltaPayload,
	CanonicalAgentId,
	ConfigOptionData as CanonicalConfigOptionData,
	ConfigOptionValue as CanonicalConfigOptionValue,
	FailureReason,
	InteractionSnapshot,
	JsonValue,
	OperationSnapshot,
	QuestionData,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionOpenFound,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionTurnState,
	TranscriptDelta,
	TranscriptEntry,
	TranscriptSnapshot,
	TurnFailureSnapshot,
	UsageTelemetryData,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../services/acp-types.js";
import type { HistoryEntry } from "../../services/claude-history-types.js";
import type { PlanData } from "../../services/converted-session-types.js";
import type { Attachment } from "../components/agent-input/types/attachment.js";
import type { AppError } from "../errors/app-error.js";
import type { ComposerMachineEvent } from "../logic/composer-machine.js";
import { deriveStoreComposerState, type StoreComposerState } from "../logic/composer-ui-state.js";
import { routeSessionStateEnvelope } from "../session-state/session-state-command-router.js";
import {
	agentPanelCanonicalSourceFromGraph,
	type AgentPanelCanonicalSource,
} from "../session-state/agent-panel-canonical-source.js";
import { markInteractionSnapshotArrayPatch } from "../session-state/interaction-snapshot-array-patch.js";
import { markOperationSnapshotArrayPatch } from "../session-state/operation-snapshot-array-patch.js";
import { mergeInteractionSnapshots, mergeOperationSnapshots } from "./snapshot-merge.js";
import {
	appendTranscriptSegment,
	replaceTranscriptEntry,
	seedTranscriptEntryIndex,
} from "./transcript-entry-index.js";
export { transcriptEntryIndexes } from "./transcript-entry-index.js";
import { sessionColdFromExistingSession } from "./session-cold-index.js";
import type { SessionLiveSyncReference, SessionPaletteReference } from "./session-cold-index.js";
export type { SessionLiveSyncReference, SessionPaletteReference } from "./session-cold-index.js";
import { SessionListState as SessionListStateStore } from "./session-list-state.svelte.js";
import {
	applyTranscriptDeltaToSnapshot,
	buildRowTokenStreamKey,
	cloneRowTokenStreamMap,
	countAppendedMarkdownWords,
	emptyRowTokenStream,
} from "./transcript-delta.js";
export { applyTranscriptDeltaToSnapshot, countAppendedMarkdownWords } from "./transcript-delta.js";
import {
	graphWithCapabilities,
	graphWithLifecycle,
	graphWithPatches,
	graphWithTranscriptSnapshot,
	type SessionExportContentError,
} from "./session-graph-builders.js";
export type { SessionExportContentError, SessionExportContentErrorKind } from "./session-graph-builders.js";
import { sanitizeCanonicalCapabilities } from "./canonical-config-sanitize.js";
export {
	mergeInteractionSnapshots,
	mergeOperationSnapshots,
	operationSnapshotIndexes,
} from "./snapshot-merge.js";
import { toArrayIndex } from "./array-index-utils.js";
import { markTranscriptEntryArrayPatch } from "../session-state/transcript-entry-array-patch.js";
import { materializeSnapshotFromOpenFound } from "../session-state/session-state-protocol.js";
import type { AvailableCommand } from "../types/available-command.js";
import { canonicalAgentIdToString, isBuiltInCanonicalAgentId } from "../types/agent-id.js";
import type { PermissionRequest } from "../types/permission.js";
import type { ToolKind } from "../types/tool-kind.js";
import type { ActiveTurnFailure, TurnErrorUpdate } from "../types/turn-error.js";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import type {
	CanonicalSessionProjection,
	RowTokenStream,
	SessionClockAnchor,
} from "./canonical-session-projection.js";
import { ComposerMachineService } from "./composer-machine-service.svelte.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import {
	buildSessionOperationInteractionSnapshot,
	type SessionOperationInteractionSnapshot,
} from "./operation-association.js";
import { getPrimaryQuestionText } from "./question-selectors.js";
import { buildQueueSessionSnapshot, type QueueSessionSnapshot } from "./queue/utils.js";
import {
	deriveLiveSessionLifecyclePresentation,
	deriveLiveSessionState,
	deriveLiveSessionWorkProjection,
	inactiveSessionWorkSourceFromCanonicalProjection,
	liveSessionWorkSourceFromCanonicalProjection,
	type LiveSessionLifecyclePresentation,
	type LiveSessionWorkSource,
} from "./live-session-work.js";
import type { ISessionStateReader, ISessionStateWriter } from "./services/interfaces/index.js";
import { SessionConnectionService } from "./session-connection-service.svelte.js";
import type { SessionEventHandler } from "./session-event-handler.js";
import {
	SessionEventService,
	type SessionEventServiceCallbacks,
} from "./session-event-service.svelte.js";
import type {
	Mode,
	Model,
	SessionCapabilities,
	SessionCold,
	SessionContextBudget,
	SessionIdentity,
	SessionLinkedPr,
	SessionMetadata,
	SessionMutableColdUpdates,
	SessionPendingSendIntent,
	SessionPrLinkMode,
	SessionTransientProjection,
	SessionUsageTelemetry,
} from "./types.js";
import type { SessionPrLinkReference } from "../application/dto/session-linked-pr.js";
import "../errors/app-error.js";
import type { GitStackedPrStep, PrChecks, PrDetails } from "../../utils/tauri-client/git.js";
import { sessionColdFromSlices } from "../application/dto/session-cold.js";
import {
	deriveSessionListStateFromCanonical,
	type SessionListState,
} from "../application/dto/session-summary.js";
import { ConnectionError, SessionNotFoundError } from "../errors/app-error.js";
import type { ToolCall } from "../types/tool-call.js";
import { createLogger } from "../utils/logger.js";
import * as preferencesStore from "./agent-model-preferences-store.svelte.js";
import { api } from "./api.js";
import { OperationStore } from "./operation-store.svelte.js";
import {
	isPermissionRepresentedByOperation,
	visiblePermissionsForOperations,
} from "./permission-operation-projection.js";
import { canActivateCreatedSessionWithFirstPrompt } from "./services/first-send-activation.js";
import {
	type CreatedPendingSessionResult,
	SessionConnectionManager,
} from "./services/session-connection-manager.js";
import { SessionMessagingService } from "./services/session-messaging-service.js";
import { SessionRepository } from "./services/session-repository.js";
import { SessionEntryStore } from "./session-entry-store.svelte.js";
import { getTitleUpdateFromUserMessage } from "./session-title-policy.js";
import { SessionTransientProjectionStore } from "./session-transient-projection-store.svelte.js";
import type {
	BufferProjection,
	ViewportAttachmentStatus,
} from "./transcript-viewport-store.svelte.js";
import { ViewportProjectionController } from "./viewport-projection-controller.svelte.js";
import { SessionExportService } from "./session-export-service.js";
import { CapabilityProjectionReader } from "./capability-projection-reader.js";
import { deriveCapabilityPreviewState } from "./capability-projection.js";
import { SessionProjectionCore } from "./session-projection-core.svelte.js";
import { PrLinkStateStore } from "./pr-link-state-store.svelte.js";
import { AwaitingModelRefreshStore } from "./awaiting-model-refresh-store.svelte.js";

const logger = createLogger({ id: "session-store", name: "SessionStore" });

const SESSION_STORE_KEY = Symbol("session-store");
let currentSessionStore: SessionStore | null = null;

type ProjectionTurnFailure = {
	readonly turn_id?: TurnFailureSnapshot["turn_id"];
	readonly message: TurnFailureSnapshot["message"];
	readonly code?: TurnFailureSnapshot["code"];
	readonly kind: TurnFailureSnapshot["kind"];
	readonly source?: TurnFailureSnapshot["source"] | null;
};

type SessionQueueSnapshotInput = {
	readonly sessionId: string;
	readonly agentId: string;
	readonly projectPath: string;
	readonly title: string | null;
	readonly updatedAt: Date;
	readonly interactionStore: InteractionStore;
	readonly hasUnseenCompletion: boolean;
	readonly active?: boolean;
};

type SessionListItemPresentationInput = {
	readonly sessionId: string;
	readonly interactionStore: InteractionStore;
	readonly hasUnseenCompletion: boolean;
	readonly active: boolean;
};

type SessionTransientProjectionUpdates = {
	-readonly [K in keyof SessionTransientProjection]?: SessionTransientProjection[K];
};

type CreatedSessionHydrator = {
	hydrateCreated(found: SessionOpenFound): ResultAsync<void, AppError>;
};

export type SessionCreationResult =
	| { readonly kind: "ready"; readonly session: SessionCold }
	| CreatedPendingSessionResult;

type LiveSessionStateGraphConsumer = {
	replaceSessionStateGraph(graph: SessionStateGraph): void;
	applySessionInteractionPatches?(snapshots: ReadonlyArray<InteractionSnapshot>): void;
};

export type SessionQuestionInteractionSnapshot = InteractionSnapshot & {
	readonly kind: "Question";
	readonly payload: { readonly Question: QuestionData };
};

function isSessionQuestionInteraction(
	interaction: InteractionSnapshot
): interaction is SessionQuestionInteractionSnapshot {
	return interaction.kind === "Question" && "Question" in interaction.payload;
}

type InflightSessionStateRefresh = ResultAsync<void, AppError>;




function resolveContextBudget(
	usageTelemetryData: UsageTelemetryData,
	previous: SessionUsageTelemetry | undefined,
	_currentModelId: string | null,
	updatedAt: number
): SessionContextBudget | null {
	const explicitMaxTokens = usageTelemetryData.contextWindowSize ?? null;
	if (explicitMaxTokens != null && explicitMaxTokens > 0) {
		return {
			maxTokens: explicitMaxTokens,
			source: "provider-explicit",
			scope: usageTelemetryData.scope ?? "step",
			updatedAt,
		};
	}

	if (previous?.contextBudget?.source === "provider-explicit") {
		return previous.contextBudget;
	}

	return previous?.contextBudget ?? null;
}

function buildCanonicalUsageTelemetry(
	usageTelemetryData: UsageTelemetryData,
	previous: SessionUsageTelemetry | undefined,
	currentModelId: string | null
): SessionUsageTelemetry | null {
	const eventId = usageTelemetryData.eventId ?? null;
	if (eventId !== null && previous?.lastTelemetryEventId === eventId) {
		return null;
	}

	const costUsd = usageTelemetryData.costUsd ?? 0;
	const sessionSpendUsd = (previous?.sessionSpendUsd ?? 0) + costUsd;
	const tokens = usageTelemetryData.tokens;
	const updatedAt = Date.now();

	return {
		sessionSpendUsd,
		latestStepCostUsd: usageTelemetryData.costUsd ?? null,
		latestTokensTotal: tokens?.total ?? null,
		latestTokensInput: tokens?.input ?? null,
		latestTokensOutput: tokens?.output ?? null,
		latestTokensCacheRead: tokens?.cacheRead ?? null,
		latestTokensCacheWrite: tokens?.cacheWrite ?? null,
		latestTokensReasoning: tokens?.reasoning ?? null,
		lastTelemetryEventId: eventId,
		contextBudget: resolveContextBudget(usageTelemetryData, previous, currentModelId, updatedAt),
		updatedAt,
	};
}

function mapProjectionTurnFailure(
	failure: ProjectionTurnFailure | null | undefined
): ActiveTurnFailure | null {
	if (failure == null) {
		return null;
	}

	return {
		turnId: failure.turn_id ?? null,
		message: failure.message,
		code: failure.code ?? null,
		kind: failure.kind,
		source: failure.source ?? "unknown",
	};
}

function preserveCanonicalStreamingState(projection: CanonicalSessionProjection | null): {
	readonly tokenStream: ReadonlyMap<string, RowTokenStream>;
	readonly clockAnchor: SessionClockAnchor | null;
} {
	return {
		tokenStream: projection?.tokenStream ?? emptyRowTokenStream(),
		clockAnchor: projection?.clockAnchor ?? null,
	};
}

function getBrowserMonotonicMs(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}

function sessionColdFromOpenSnapshotInput(input: {
	readonly id: string;
	readonly projectPath: string;
	readonly agentId: string;
	readonly worktreePath?: string;
	readonly title: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly sourcePath?: string;
	readonly sessionLifecycleState: SessionMetadata["sessionLifecycleState"];
	readonly parentId: string | null;
	readonly sequenceId: number | null;
	readonly preservedMetadata?: SessionMetadata;
}): SessionCold {
	return sessionColdFromSlices(
		{
			id: input.id,
			projectPath: input.projectPath,
			agentId: input.agentId,
			worktreePath: input.worktreePath,
		},
		{
			title: input.title,
			createdAt: input.createdAt,
			updatedAt: input.updatedAt,
			sourcePath: input.sourcePath,
			sessionLifecycleState: input.sessionLifecycleState,
			parentId: input.parentId,
			prNumber: input.preservedMetadata?.prNumber,
			prState: input.preservedMetadata?.prState,
			prLinkMode: input.preservedMetadata?.prLinkMode,
			linkedPr: input.preservedMetadata?.linkedPr,
			worktreeDeleted: input.preservedMetadata?.worktreeDeleted,
			sequenceId: input.sequenceId ?? input.preservedMetadata?.sequenceId,
		}
	);
}

function emptySessionGraphCapabilities(): SessionGraphCapabilities {
	return {
		models: null,
		modes: null,
		availableCommands: null,
		configOptions: null,
		autonomousEnabled: null,
	};
}

function canonicalAgentIdFromSessionAgentId(agentId: string | null | undefined): CanonicalAgentId {
	if (agentId && isBuiltInCanonicalAgentId(agentId)) {
		return agentId;
	}

	return { custom: agentId ?? "unknown" };
}

function createLifecycleOnlyGraph(input: {
	readonly sessionId: string;
	readonly session: SessionCold | undefined;
	readonly lifecycle: SessionGraphLifecycle;
	readonly activity: SessionGraphActivity;
	readonly turnState: SessionTurnState;
	readonly activeTurnFailure: TurnFailureSnapshot | null;
	readonly lastTerminalTurnId: string | null;
	readonly capabilities: SessionGraphCapabilities;
	readonly revision: SessionGraphRevision;
}): SessionStateGraph {
	return {
		requestedSessionId: input.sessionId,
		canonicalSessionId: input.sessionId,
		isAlias: false,
		agentId: canonicalAgentIdFromSessionAgentId(input.session?.agentId),
		projectPath: input.session?.projectPath ?? "",
		worktreePath: input.session?.worktreePath ?? null,
		sourcePath: input.session?.sourcePath ?? null,
		revision: input.revision,
		transcriptSnapshot: {
			revision: input.revision.transcriptRevision,
			entries: [],
		},
		operations: [],
		interactions: [],
		turnState: input.turnState,
		messageCount: 0,
		activeStreamingTail: null,
		activeTurnFailure: input.activeTurnFailure,
		lastTerminalTurnId: input.lastTerminalTurnId,
		lifecycle: input.lifecycle,
		activity: input.activity,
		capabilities: input.capabilities,
	};
}

function isNewerGraphRevision(
	current: SessionGraphRevision | null,
	incoming: SessionGraphRevision
): boolean {
	if (current === null) {
		return true;
	}

	if (incoming.graphRevision !== current.graphRevision) {
		return incoming.graphRevision > current.graphRevision;
	}

	if (incoming.lastEventSeq !== current.lastEventSeq) {
		return incoming.lastEventSeq > current.lastEventSeq;
	}

	return incoming.transcriptRevision > current.transcriptRevision;
}

function isOlderGraphRevision(
	current: SessionGraphRevision | null,
	incoming: SessionGraphRevision
): boolean {
	if (current === null) {
		return false;
	}

	if (incoming.graphRevision !== current.graphRevision) {
		return incoming.graphRevision < current.graphRevision;
	}

	if (incoming.lastEventSeq !== current.lastEventSeq) {
		return incoming.lastEventSeq < current.lastEventSeq;
	}

	return incoming.transcriptRevision < current.transcriptRevision;
}

function connectionErrorFromGraphState(
	lifecycle: SessionGraphLifecycle,
	activeTurnFailure: ActiveTurnFailure | null
): string | null {
	if (lifecycle.status === "failed" || lifecycle.status === "detached") {
		return lifecycle.errorMessage ?? null;
	}

	if (activeTurnFailure !== null) {
		return null;
	}

	return null;
}

function cloneSessionGraphActivity(activity: SessionGraphActivity): SessionGraphActivity {
	return {
		kind: activity.kind,
		activeOperationCount: activity.activeOperationCount,
		activeSubagentCount: activity.activeSubagentCount,
		dominantOperationId: activity.dominantOperationId ?? null,
		blockingInteractionId: activity.blockingInteractionId ?? null,
	};
}


function emptySessionGraphActivity(kind: SessionGraphActivity["kind"]): SessionGraphActivity {
	return {
		kind,
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function deriveRecoveredActivityKind(
	activity: SessionGraphActivity,
	turnState: SessionTurnState
): SessionGraphActivity["kind"] {
	if (activity.blockingInteractionId != null) {
		return "waiting_for_user";
	}

	if (activity.activeOperationCount > 0) {
		return "running_operation";
	}

	if (turnState === "Running") {
		return "awaiting_model";
	}

	return "idle";
}

function reconcileStoredGraphActivity(
	activity: SessionGraphActivity | null | undefined,
	lifecycle: SessionGraphLifecycle,
	turnState: SessionTurnState,
	activeTurnFailure: ActiveTurnFailure | null
): SessionGraphActivity | null {
	const previousActivity = activity ?? null;

	if (lifecycle.status === "failed" || activeTurnFailure !== null) {
		if (previousActivity === null) {
			return {
				kind: "error",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			};
		}

		return {
			kind: "error",
			activeOperationCount: previousActivity.activeOperationCount,
			activeSubagentCount: previousActivity.activeSubagentCount,
			dominantOperationId: previousActivity.dominantOperationId ?? null,
			blockingInteractionId: previousActivity.blockingInteractionId ?? null,
		};
	}

	if (previousActivity === null) {
		if (turnState === "Running") {
			return emptySessionGraphActivity("awaiting_model");
		}
		return null;
	}

	if (previousActivity.kind === "idle" && turnState === "Running") {
		return emptySessionGraphActivity("awaiting_model");
	}

	if (previousActivity.kind === "awaiting_model" && turnState !== "Running") {
		return emptySessionGraphActivity("idle");
	}

	if (previousActivity.kind !== "error") {
		return cloneSessionGraphActivity(previousActivity);
	}

	return {
		kind: deriveRecoveredActivityKind(previousActivity, turnState),
		activeOperationCount: previousActivity.activeOperationCount,
		activeSubagentCount: previousActivity.activeSubagentCount,
		dominantOperationId: previousActivity.dominantOperationId ?? null,
		blockingInteractionId: previousActivity.blockingInteractionId ?? null,
	};
}

function transcriptSnapshotContainsUserAttemptId(
	snapshot: TranscriptSnapshot,
	attemptId: string
): boolean {
	for (const entry of snapshot.entries) {
		if (entry.role === "user" && entry.attemptId === attemptId) {
			return true;
		}
	}

	return false;
}

function transcriptEntryText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		text += segment.text;
	}
	return text;
}

function pendingSendText(pendingSendIntent: SessionPendingSendIntent): string | null {
	if (pendingSendIntent.optimisticEntry.type !== "user") {
		return null;
	}
	const content = pendingSendIntent.optimisticEntry.message.content;
	if (content.type !== "text") {
		return null;
	}
	return content.text.trim();
}

function transcriptSnapshotAcknowledgesPendingSend(
	snapshot: TranscriptSnapshot,
	pendingSendIntent: SessionPendingSendIntent
): boolean {
	if (transcriptSnapshotContainsUserAttemptId(snapshot, pendingSendIntent.attemptId)) {
		return true;
	}

	if (
		pendingSendIntent.baselineTranscriptRevision === null ||
		snapshot.revision <= pendingSendIntent.baselineTranscriptRevision
	) {
		return false;
	}

	const expectedText = pendingSendText(pendingSendIntent);
	if (expectedText === null || expectedText.length === 0) {
		return false;
	}

	for (const entry of snapshot.entries) {
		if (entry.role === "user" && transcriptEntryText(entry).trim() === expectedText) {
			return true;
		}
	}

	return false;
}

/**
 * Callbacks for handling permission and question requests.
 * These are set during initialization to avoid circular dependencies.
 */
export interface SessionStoreCallbacks {
	onPlanUpdate?: (sessionId: string, planData: PlanData) => void;
	onTurnComplete?: (sessionId: string) => void;
	onTurnInterrupted?: (sessionId: string) => void;
	onTurnError?: (sessionId: string) => void;
}

export class SessionStore implements SessionEventHandler, ISessionStateReader, ISessionStateWriter {
	// === PRIMARY STATE ===
	// Session-list slice (cold list, by-id/by-project indexes, reference arrays,
	// per-project scan flags) extracted as a composed sub-store (see docs/adr/0002).
	private readonly listState = new SessionListStateStore();
	loading = $state(false);

	// Delegating accessors so the store's list-domain reads route to the sub-store
	// while keeping the same live instances (preserves white-box invariant tests).
	private get sessions(): SessionCold[] {
		return this.listState.sessions;
	}
	private get sessionById(): SvelteMap<string, SessionCold> {
		return this.listState.sessionById;
	}
	private get sessionsByProject(): SvelteMap<string, SessionCold[]> {
		return this.listState.sessionsByProject;
	}
	private get sessionIdsByProject(): SvelteMap<string, string[]> {
		return this.listState.sessionIdsByProject;
	}
	private get liveSessionSyncReferences(): SessionLiveSyncReference[] {
		return this.listState.liveSessionSyncReferences;
	}
	private get sessionPaletteReferences(): SessionPaletteReference[] {
		return this.listState.sessionPaletteReferences;
	}

	/** Project paths currently being scanned for sessions (for per-project skeleton display). */
	get scanningProjectPaths(): SvelteSet<string> {
		return this.listState.scanningProjectPaths;
	}

	// Callbacks invoked when a session is removed (e.g., plan store cleanup)
	private readonly onRemoveCallbacks: Array<(sessionId: string) => void> = [];

	// Transient projection store for local-only UI state.
	private readonly transientProjectionStore = new SessionTransientProjectionStore();

	// Canonical projection state (CanonicalSessionProjection + SessionStateGraph
	// maps, capabilities-materialized flags, row-token-stream index) is owned by
	// the SessionProjectionCore sub-store (ADR-0002). The envelope dispatch loop
	// (the canonical write spine) writes through these accessors; sub-stores and
	// readers consume them. Getter accessors keep all existing call sites and the
	// unit 2-4 dependency closures working against the live maps.
	private readonly projectionCore = new SessionProjectionCore();
	private get canonicalProjections(): SvelteMap<string, CanonicalSessionProjection> {
		return this.projectionCore.canonicalProjections;
	}
	private get sessionStateGraphs(): SvelteMap<string, SessionStateGraph> {
		return this.projectionCore.sessionStateGraphs;
	}
	private get canonicalCapabilitiesMaterialized(): SvelteMap<string, boolean> {
		return this.projectionCore.canonicalCapabilitiesMaterialized;
	}
	private get rowTokenStreamsByRowId(): Map<string, Map<string, RowTokenStream>> {
		return this.projectionCore.rowTokenStreamsByRowId;
	}
	private readonly viewport = new ViewportProjectionController({
		connectSession: (sessionId, options) => this.connectSession(sessionId, options),
		getGraphRevision: (sessionId) => this.getGraphRevision(sessionId),
		applySessionStateEnvelope: (sessionId, envelope) =>
			this.applySessionStateEnvelope(sessionId, envelope),
	});
	private readonly exportService = new SessionExportService({
		getSessionStateGraph: (sessionId) => this.sessionStateGraphs.get(sessionId) ?? null,
		getSessionIdentity: (sessionId) => this.getSessionIdentity(sessionId),
		getSessionMetadata: (sessionId) => this.getSessionMetadata(sessionId),
	});
	private readonly capabilityReader = new CapabilityProjectionReader({
		getCanonicalProjection: (sessionId) => this.canonicalProjections.get(sessionId) ?? null,
		getSessionIdentity: (sessionId) => this.getSessionIdentity(sessionId),
		isCapabilitiesMaterialized: (sessionId) =>
			this.canonicalCapabilitiesMaterialized.get(sessionId) === true,
		getTransientProjection: (sessionId) => this.getTransientProjection(sessionId),
	});
	private readonly pendingCreationSessions = new SvelteMap<string, CreatedPendingSessionResult>();

	// Canonical tool execution domain state
	private readonly operationStore = new OperationStore();

	// Entry store (entries + chunk aggregation)
	private readonly entryStore = new SessionEntryStore(this.operationStore);
	private sessionOpenHydrator: CreatedSessionHydrator | null = null;
	private liveSessionStateGraphConsumer: LiveSessionStateGraphConsumer | null = null;
	private readonly inflightSessionStateRefreshes = new Map<string, InflightSessionStateRefresh>();

	// Awaiting-model snapshot refresh timers (ADR-0002 sub-store)
	private readonly awaitingModelRefresh = new AwaitingModelRefreshStore({
		refreshSessionStateSnapshot: (sessionId) => this.refreshSessionStateSnapshot(sessionId),
		getCanonicalProjection: (sessionId) => this.canonicalProjections.get(sessionId) ?? null,
	});

	// PR link cache and refresh state (ADR-0002 sub-store)
	private readonly prLinkState = new PrLinkStateStore({
		getSessionMetadata: (sessionId) => this.getSessionMetadata(sessionId),
		getSessionIdentity: (sessionId) => this.getSessionIdentity(sessionId),
		getSessions: () => this.sessions,
		getSessionsByProject: (projectPath) => this.sessionsByProject.get(projectPath),
		updateSession: (id, updates, options) => this.updateSession(id, updates, options),
	});

	// Connection service (state machines + connection tracking)
	private readonly connectionService = new SessionConnectionService();

	// Composer policy actors (submit/config/dispatch gating)
	private readonly composerMachineService = new ComposerMachineService((sessionId) => ({
		modeId: this.getSessionCurrentModeId(sessionId),
		modelId: this.getSessionCurrentModelId(sessionId),
		autonomousEnabled: this.getSessionAutonomousEnabled(sessionId),
	}));

	// Repository for CRUD and loading operations
	private readonly repository: SessionRepository;

	// Connection manager for connection lifecycle
	private readonly connectionMgr: SessionConnectionManager;

	// Messaging service for message sending and streaming
	private readonly messagingSvc: SessionMessagingService;

	// === SERVICES ===
	private eventService: SessionEventService;
	private callbacks: SessionStoreCallbacks = {};

	constructor() {
		this.eventService = new SessionEventService();
		// Create repository with this store as the state reader/writer
		this.repository = new SessionRepository(this, this, this.entryStore, this.connectionService);
		// Create connection manager
		this.connectionMgr = new SessionConnectionManager(
			this,
			this,
			this.transientProjectionStore,
			this.entryStore,
			this.connectionService,
			this.eventService
		);
		// Create messaging service
		this.messagingSvc = new SessionMessagingService(
			this,
			this.transientProjectionStore,
			this.entryStore,
			this.connectionService
		);
	}

	// ============================================
	// ISessionStateWriter IMPLEMENTATION
	// ============================================

	/**
	 * Set sessions array (for bulk operations).
	 */
	setSessions(sessions: SessionCold[]): void {
		this.listState.setSessions(sessions);
	}

	/**
	 * Set loading state.
	 */
	setLoading(loading: boolean): void {
		this.loading = loading;
	}

	/**
	 * Mark project paths as currently being scanned.
	 */
	addScanningProjects(paths: string[]): void {
		this.listState.addScanningProjects(paths);
	}

	/**
	 * Clear scanning state for project paths.
	 */
	removeScanningProjects(paths: string[]): void {
		this.listState.removeScanningProjects(paths);
	}

	// ============================================
	// ISessionStateReader IMPLEMENTATION
	// ============================================

	/**
	 * Get all sessions (cold data only).
	 */
	getAllSessions(): SessionCold[] {
		const sessions: SessionCold[] = [];
		for (const session of this.sessions) {
			sessions.push(sessionColdFromExistingSession(session));
		}
		return sessions;
	}

	// ============================================
	// CALLBACKS
	// ============================================

	/**
	 * Set callbacks for handling permission and question requests.
	 */
	setCallbacks(callbacks: SessionStoreCallbacks): void {
		this.callbacks = callbacks;
		const eventCallbacks: SessionEventServiceCallbacks = {
			onPlanUpdate: callbacks.onPlanUpdate,
			onTurnComplete: callbacks.onTurnComplete,
		};
		this.eventService.setCallbacks(eventCallbacks);
	}

	// ============================================
	// SESSION RETRIEVAL
	// ============================================

	/**
	 * Get transient projection for a session.
	 */
	private getTransientProjection(sessionId: string): SessionTransientProjection {
		return this.transientProjectionStore.getTransientProjection(sessionId);
	}

	getSessionStateGraphForTest(sessionId: string): SessionStateGraph | null {
		return this.sessionStateGraphs.get(sessionId) ?? null;
	}

	getTranscriptViewportBufferProjection(sessionId: string | null): BufferProjection | null {
		return this.viewport.getBufferProjection(sessionId);
	}

	nextViewportRequestGeneration(sessionId: string | null): number {
		return this.viewport.nextRequestGeneration(sessionId);
	}

	viewportNeedsRefill(
		sessionId: string | null,
		scrollTopPx: number,
		viewportHeightPx: number,
		thresholdPx: number
	): boolean {
		return this.viewport.needsRefill(sessionId, scrollTopPx, viewportHeightPx, thresholdPx);
	}

	viewportIsOutsideBuffer(
		sessionId: string | null,
		scrollTopPx: number,
		viewportHeightPx: number
	): boolean {
		return this.viewport.isOutsideBuffer(sessionId, scrollTopPx, viewportHeightPx);
	}

	/**
	 * Reactive read of the accumulated, unconsumed relative scroll correction
	 * (px) for a session WITHOUT clearing it. Pure pass-through so the component
	 * never reaches into the transcript viewport store directly.
	 */
	peekViewportScrollCorrectionPx(sessionId: string | null): number {
		return this.viewport.peekScrollCorrectionPx(sessionId);
	}

	/**
	 * Consume (return and zero) the accumulated relative scroll correction (px)
	 * for a session. Idempotent: returns 0 once drained.
	 */
	consumeViewportScrollCorrectionPx(sessionId: string | null): number {
		return this.viewport.consumeScrollCorrectionPx(sessionId);
	}

	/**
	 * Bootstrap the buffer for a freshly-mounted viewport. Idempotent: no-op once
	 * a buffer projection exists.
	 */
	ensureViewportBufferBootstrap(sessionId: string): void {
		this.viewport.ensureBufferBootstrap(sessionId);
	}

	getViewportAttachmentStatus(sessionId: string | null): ViewportAttachmentStatus {
		return this.viewport.getAttachmentStatus(sessionId);
	}

	/**
	 * Recover a viewport that the backend reports as not attached (typically
	 * after a Rust runtime reload drifted the frontend/backend attachment).
	 * Delegated to the viewport controller, which forces a reconnect and arms a
	 * bounded watchdog so the episode fails deterministically if the live
	 * visible-window envelope never arrives.
	 */
	recoverViewportAttachment(sessionId: string): void {
		this.viewport.recoverAttachment(sessionId);
	}

	/**
	 * Canonical session-list status summary; uses Rust-owned lifecycle/activity only.
	 */
	getSessionListState(sessionId: string): SessionListState {
		return deriveSessionListStateFromCanonical(this.canonicalProjections.get(sessionId) ?? null);
	}

	hasSessionCanonicalProjection(sessionId: string): boolean {
		return this.projectionCore.hasCanonicalProjection(sessionId);
	}

	/**
	 * Canonical message count; null means no canonical graph exists yet.
	 */
	getSessionMessageCount(sessionId: string): number | null {
		return this.projectionCore.getMessageCount(sessionId);
	}

	/**
	 * Canonical transcript entries; null means no canonical graph exists yet.
	 */
	getSessionTranscriptEntries(sessionId: string): ReadonlyArray<TranscriptEntry> | null {
		return this.projectionCore.getTranscriptEntries(sessionId);
	}

	getSessionAgentPanelCanonicalSource(sessionId: string): AgentPanelCanonicalSource | null {
		const graph = this.sessionStateGraphs.get(sessionId) ?? null;
		if (graph === null) {
			return null;
		}

		return agentPanelCanonicalSourceFromGraph(graph);
	}

	getSessionQuestionInteraction(
		sessionId: string,
		interactionId: string
	): SessionQuestionInteractionSnapshot | null {
		const graph = this.sessionStateGraphs.get(sessionId) ?? null;
		if (graph === null) {
			return null;
		}

		for (const interaction of graph.interactions) {
			if (interaction.id !== interactionId) {
				continue;
			}
			if (!isSessionQuestionInteraction(interaction)) {
				return null;
			}
			return interaction;
		}

		return null;
	}

	getSessionMarkdownExportContent(sessionId: string): Result<string, SessionExportContentError> {
		return this.exportService.getMarkdownExportContent(sessionId);
	}

	getSessionJsonExportContent(sessionId: string): Result<string, SessionExportContentError> {
		return this.exportService.getJsonExportContent(sessionId);
	}

	hasPendingCreationSession(sessionId: string): boolean {
		return this.pendingCreationSessions.has(sessionId);
	}

	materializePendingCreationSession(sessionId: string): boolean {
		if (this.getSessionIdentity(sessionId)) {
			this.pendingCreationSessions.delete(sessionId);
			return true;
		}

		const pendingCreation = this.pendingCreationSessions.get(sessionId) ?? null;
		if (pendingCreation === null) {
			return false;
		}

		const now = new Date();
		this.addSession({
			id: sessionId,
			projectPath: pendingCreation.projectPath,
			agentId: pendingCreation.agentId,
			worktreePath: pendingCreation.worktreePath ?? undefined,
			title: pendingCreation.title ?? "New Thread",
			updatedAt: now,
			createdAt: now,
			sourcePath: undefined,
			sessionLifecycleState: "created",
			parentId: null,
		});
		this.pendingCreationSessions.delete(sessionId);
		return true;
	}

	getSessionCanSend(sessionId: string): boolean | null {
		return this.projectionCore.getCanSend(sessionId);
	}

	getSessionLifecycleStatus(sessionId: string): SessionGraphLifecycle["status"] | null {
		return this.projectionCore.getLifecycleStatus(sessionId);
	}

	getSessionLifecycle(sessionId: string): SessionGraphLifecycle | null {
		return this.projectionCore.getLifecycle(sessionId);
	}

	getSessionActivity(sessionId: string): SessionGraphActivity | null {
		return this.projectionCore.getActivity(sessionId);
	}

	getSessionGraphRevision(sessionId: string): SessionGraphRevision | null {
		return this.projectionCore.getGraphRevisionOrNull(sessionId);
	}

	/**
	 * Canonical turn state; null means no canonical graph exists yet.
	 */
	getSessionTurnState(sessionId: string): SessionTurnState | null {
		return this.projectionCore.getTurnState(sessionId);
	}

	getSessionLifecyclePresentation(sessionId: string): LiveSessionLifecyclePresentation {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		const graph = this.sessionStateGraphs.get(sessionId) ?? null;
		const transientProjection = this.transientProjectionStore.getTransientProjection(sessionId);

		return deriveLiveSessionLifecyclePresentation({
			source: liveSessionWorkSourceFromCanonicalProjection(sessionId, projection),
			hasEntries: graph === null ? null : graph.transcriptSnapshot.entries.length > 0,
			hasLocalPendingSendIntent: transientProjection.pendingSendIntent !== null,
		});
	}

	getSessionAgentPanelSessionSource(sessionId: string | null) {
		if (sessionId === null) {
			return {
				kind: "no_session" as const,
			};
		}

		const graph = this.sessionStateGraphs.get(sessionId) ?? null;
		if (graph === null) {
			return {
				kind: "missing_canonical" as const,
				sessionId,
			};
		}

		return {
			kind: "canonical" as const,
			lifecycle: graph.lifecycle,
			activity: graph.activity,
			turnState: graph.turnState,
		};
	}

	getSessionLiveWorkSource(sessionId: string | null, active: boolean): LiveSessionWorkSource {
		const projection =
			sessionId === null ? null : (this.canonicalProjections.get(sessionId) ?? null);
		if (active) {
			return liveSessionWorkSourceFromCanonicalProjection(sessionId, projection);
		}
		return inactiveSessionWorkSourceFromCanonicalProjection(sessionId, projection);
	}

	getSessionQueueSnapshot(input: SessionQueueSnapshotInput): QueueSessionSnapshot {
		const interactionSnapshot = this.getSessionOperationInteractionSnapshot(
			input.sessionId,
			input.interactionStore
		);
		return this.buildSessionQueueSnapshot(input, interactionSnapshot);
	}

	getSessionQueuePresentation(input: SessionQueueSnapshotInput) {
		const interactionSnapshot = this.getSessionOperationInteractionSnapshot(
			input.sessionId,
			input.interactionStore
		);
		const session = this.buildSessionQueueSnapshot(input, interactionSnapshot);
		const pendingQuestion = interactionSnapshot.pendingQuestion;
		const pendingPlanApproval = interactionSnapshot.pendingPlanApproval;
		const pendingPermission = interactionSnapshot.pendingPermission;

		return {
			session,
			hasPendingQuestion: pendingQuestion !== null,
			hasPendingPermission: pendingPermission !== null,
			hasUnseenCompletion: session.state.attention.hasUnseenCompletion,
			pendingQuestionText: getPrimaryQuestionText(pendingQuestion),
			pendingQuestion,
			pendingPlanApproval,
			pendingPermission,
		};
	}

	private buildSessionQueueSnapshot(
		input: SessionQueueSnapshotInput,
		interactionSnapshot: Pick<
			SessionOperationInteractionSnapshot,
			"pendingPlanApproval" | "pendingPermission" | "pendingQuestion"
		>
	): QueueSessionSnapshot {
		const sessionId = input.sessionId;
		return buildQueueSessionSnapshot({
			id: sessionId,
			agentId: input.agentId,
			projectPath: input.projectPath,
			title: input.title,
			currentStreamingToolCall: this.getSessionCurrentStreamingToolCall(sessionId),
			currentToolKind: this.getSessionCurrentToolKind(sessionId),
			lastToolCall: this.getSessionLastToolCall(sessionId),
			lastTodoToolCall: this.getSessionLastTodoToolCall(sessionId),
			updatedAt: input.updatedAt,
			currentModeId: this.getSessionCurrentModeId(sessionId),
			connectionError: this.getSessionConnectionError(sessionId),
			activeTurnFailure: this.getSessionActiveTurnFailure(sessionId),
			liveSessionSource: this.getSessionLiveWorkSource(sessionId, input.active ?? true),
			interactionSnapshot,
			hasUnseenCompletion: input.hasUnseenCompletion,
		});
	}

	getSessionListItemPresentation(input: SessionListItemPresentationInput) {
		const sessionId = input.sessionId;
		const currentModeId = this.getSessionCurrentModeId(sessionId);
		const currentStreamingToolCall = this.getSessionCurrentStreamingToolCall(sessionId);
		const lastToolCall = this.getSessionLastToolCall(sessionId);
		const lastTodoToolCall = this.getSessionLastTodoToolCall(sessionId);
		const currentToolKind = this.getSessionCurrentToolKind(sessionId);
		const interactionSnapshot = this.getSessionOperationInteractionSnapshot(
			sessionId,
			input.interactionStore
		);
		const liveSessionSource = this.getSessionLiveWorkSource(sessionId, input.active);
		const liveSessionState = deriveLiveSessionState({
			source: liveSessionSource,
			currentModeId,
			interactionSnapshot,
			hasUnseenCompletion: input.hasUnseenCompletion,
		});
		const sessionWorkProjection = deriveLiveSessionWorkProjection({
			source: liveSessionSource,
			currentModeId,
			interactionSnapshot,
			hasUnseenCompletion: input.hasUnseenCompletion,
		});

		return {
			connectionError: this.getSessionConnectionError(sessionId),
			currentModeId,
			currentStreamingToolCall,
			lastToolCall,
			lastTodoToolCall,
			currentToolKind,
			lastToolKind: lastToolCall ? (lastToolCall.kind ?? "other") : null,
			liveSessionState,
			sessionWorkProjection,
			previewActivityKind: sessionWorkProjection.compactActivityKind,
			pendingQuestion: interactionSnapshot.pendingQuestion,
			pendingPermission: interactionSnapshot.pendingPermission,
			pendingPlanApproval: interactionSnapshot.pendingPlanApproval,
		};
	}

	getSessionPendingSendIntent(sessionId: string): SessionPendingSendIntent | null {
		return (
			this.transientProjectionStore.getTransientProjection(sessionId).pendingSendIntent ?? null
		);
	}

	getSessionHasLocalPendingSendIntent(sessionId: string): boolean {
		return this.getSessionPendingSendIntent(sessionId) !== null;
	}

	getSessionAcpSessionId(sessionId: string): string | null {
		return this.transientProjectionStore.getTransientProjection(sessionId).acpSessionId;
	}

	getSessionUsageTelemetry(sessionId: string): SessionUsageTelemetry | null {
		return this.transientProjectionStore.getTransientProjection(sessionId).usageTelemetry ?? null;
	}

	getSessionAutonomousTransitionBusy(sessionId: string): boolean {
		return (
			this.transientProjectionStore.getTransientProjection(sessionId).autonomousTransition !==
			"idle"
		);
	}

	getSessionStatusChangedAt(sessionId: string): number {
		return this.transientProjectionStore.getTransientProjection(sessionId).statusChangedAt;
	}

	hasSessionCanonicalCapabilities(sessionId: string): boolean {
		return this.capabilityReader.hasCanonicalCapabilities(sessionId);
	}

	/**
	 * Canonical connection error copy; null means no canonical failure/detach message exists yet.
	 */
	getSessionConnectionError(sessionId: string): string | null {
		const graph = this.sessionStateGraphs.get(sessionId) ?? null;
		if (graph === null) {
			return null;
		}
		return connectionErrorFromGraphState(
			graph.lifecycle,
			mapProjectionTurnFailure(graph.activeTurnFailure ?? null)
		);
	}

	/**
	 * Canonical lifecycle failure classification, or null when the lifecycle is
	 * not in a failed state. Used by the panel error UI to compose curated
	 * user-facing copy keyed on `(agentId, failureReason)` while keeping the
	 * raw provider text under `getSessionConnectionError` for debug surfaces.
	 */
	getSessionLifecycleFailureReason(sessionId: string): FailureReason | null {
		const lifecycle = this.sessionStateGraphs.get(sessionId)?.lifecycle ?? null;
		if (lifecycle === null) {
			return null;
		}
		if (lifecycle.status !== "failed" && lifecycle.status !== "detached") {
			return null;
		}
		return lifecycle.failureReason ?? null;
	}

	/**
	 * Canonical active turn failure; null means no canonical graph or no active failure.
	 */
	getSessionActiveTurnFailure(sessionId: string): ActiveTurnFailure | null {
		return mapProjectionTurnFailure(
			this.sessionStateGraphs.get(sessionId)?.activeTurnFailure ?? null
		);
	}

	/**
	 * Canonical last terminal turn id; null means no canonical graph or no terminal turn.
	 */
	getSessionLastTerminalTurnId(sessionId: string): string | null {
		return this.projectionCore.getLastTerminalTurnId(sessionId);
	}

	getRowTokenStream(sessionId: string, turnId: string, rowId: string): RowTokenStream | null {
		return this.projectionCore.getRowTokenStream(sessionId, turnId, rowId);
	}

	getRowTokenStreamByRowId(sessionId: string, rowId: string): RowTokenStream | null {
		return this.projectionCore.getRowTokenStreamByRowId(sessionId, rowId);
	}

	getActiveStreamingTailRowId(sessionId: string): string | null {
		return this.projectionCore.getActiveStreamingTailRowId(sessionId);
	}

	getClockAnchor(sessionId: string): SessionClockAnchor | null {
		return this.projectionCore.getClockAnchor(sessionId);
	}

	/**
	 * Canonical autonomous setting; null means no canonical projection.
	 */
	getSessionAutonomousEnabled(sessionId: string): boolean | null {
		return this.capabilityReader.getAutonomousEnabled(sessionId);
	}

	/**
	 * Canonical current mode id; null means no canonical capabilities or no selected mode.
	 */
	getSessionCurrentModeId(sessionId: string): string | null {
		return this.capabilityReader.getCurrentModeId(sessionId);
	}

	/**
	 * Canonical current model id; null means no canonical capabilities or no selected model.
	 */
	getSessionCurrentModelId(sessionId: string): string | null {
		return this.capabilityReader.getCurrentModelId(sessionId);
	}

	/**
	 * Canonical available commands; null means no canonical capabilities projection.
	 */
	getSessionAvailableCommands(sessionId: string): ReadonlyArray<AvailableCommand> | null {
		return this.capabilityReader.getAvailableCommands(sessionId);
	}

	/**
	 * Canonical config options; null means no canonical capabilities projection.
	 */
	getSessionConfigOptions(sessionId: string): ReadonlyArray<CanonicalConfigOptionData> | null {
		return this.capabilityReader.getConfigOptions(sessionId);
	}

	/**
	 * Canonical available models; null means no canonical capabilities projection.
	 */
	getSessionAvailableModels(sessionId: string): ReadonlyArray<Model> | null {
		return this.capabilityReader.getAvailableModels(sessionId);
	}

	/**
	 * Canonical available modes; null means no canonical capabilities projection.
	 */
	getSessionAvailableModes(sessionId: string): ReadonlyArray<Mode> | null {
		return this.capabilityReader.getAvailableModes(sessionId);
	}

	/**
	 * Canonical model display metadata; null means no canonical capabilities projection.
	 */
	getSessionModelsDisplay(sessionId: string): ModelsForDisplay | null {
		return this.capabilityReader.getModelsDisplay(sessionId);
	}

	/**
	 * Canonical provider metadata; null means no canonical capabilities projection.
	 */
	getSessionProviderMetadata(sessionId: string): ProviderMetadataProjection | null {
		return this.capabilityReader.getProviderMetadata(sessionId);
	}

	/**
	 * Canonical capability revision; null means no materialized canonical capabilities.
	 */
	getSessionCapabilityRevision(sessionId: string): SessionGraphRevision | null {
		return this.capabilityReader.getCapabilityRevision(sessionId);
	}

	getSessionCapabilityPendingMutationId(sessionId: string): string | null {
		return this.capabilityReader.getPendingMutationId(sessionId);
	}

	getSessionCapabilityPreviewState(sessionId: string): SessionCapabilities["previewState"] | null {
		return this.capabilityReader.getPreviewState(sessionId);
	}

	/**
	 * Get session identity (immutable lookup keys).
	 */
	getSessionIdentity(sessionId: string): SessionIdentity | undefined {
		const session = this.sessionById.get(sessionId);
		if (!session) return undefined;
		return {
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			worktreePath: session.worktreePath,
		};
	}

	hasSession(sessionId: string): boolean {
		return this.sessionById.has(sessionId);
	}

	/**
	 * Get session metadata (rarely changing data).
	 */
	getSessionMetadata(sessionId: string): SessionMetadata | undefined {
		const session = this.sessionById.get(sessionId);
		if (!session) return undefined;
		return {
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			sourcePath: session.sourcePath,
			sessionLifecycleState: session.sessionLifecycleState,
			parentId: session.parentId,
			prNumber: session.prNumber,
			prState: session.prState,
			prLinkMode: session.prLinkMode,
			linkedPr: session.linkedPr,
			worktreeDeleted: session.worktreeDeleted,
			sequenceId: session.sequenceId,
		};
	}

	/**
	 * Get session cold data by ID from the lookup map (O(1)).
	 */
	getSessionCold(sessionId: string): SessionCold | undefined {
		const sessionIdentity = this.getSessionIdentity(sessionId);
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionIdentity || !sessionMetadata) {
			return undefined;
		}

		return sessionColdFromSlices(sessionIdentity, sessionMetadata);
	}

	getSessionIdsForProject(projectPath: string): string[] {
		return this.sessionIdsByProject.get(projectPath) ?? [];
	}

	getLiveSessionSyncReferences(): SessionLiveSyncReference[] {
		return this.liveSessionSyncReferences;
	}

	getLiveSessionPanelSyncInput(
		reference: SessionLiveSyncReference,
		interactions: InteractionStore
	) {
		const lifecyclePresentation = this.getSessionLifecyclePresentation(reference.id);
		const interactionSnapshot = this.getSessionOperationInteractionSnapshot(
			reference.id,
			interactions
		);
		const pendingQuestion = interactionSnapshot.pendingQuestion;
		const pendingPlanApproval = interactionSnapshot.pendingPlanApproval;
		const pendingPermission = interactionSnapshot.pendingPermission;

		return {
			sessionId: reference.id,
			updatedAtMs: reference.updatedAtMs,
			hasCanonicalProjection: this.hasSessionCanonicalProjection(reference.id),
			connectionPhase: lifecyclePresentation.connectionPhase,
			activityPhase: lifecyclePresentation.activityPhase,
			pendingQuestionId: pendingQuestion ? pendingQuestion.id : null,
			pendingPlanApprovalId: pendingPlanApproval ? pendingPlanApproval.id : null,
			pendingPermissionId: pendingPermission ? pendingPermission.id : null,
		};
	}

	getSessionPaletteReferences(): SessionPaletteReference[] {
		return this.sessionPaletteReferences;
	}

	getSessionPaletteReference(sessionId: string): SessionPaletteReference | undefined {
		const session = this.sessionById.get(sessionId);
		if (!session) {
			return undefined;
		}
		return {
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			title: session.title,
		};
	}

	getSessionPrLinkReferencesForProject(projectPath: string): SessionPrLinkReference[] {
		const sessions = this.sessionsByProject.get(projectPath) ?? [];
		const references: SessionPrLinkReference[] = [];
		for (const session of sessions) {
			if (session.prNumber == null) {
				continue;
			}
			references.push({
				id: session.id,
				prNumber: session.prNumber,
				sequenceId: session.sequenceId ?? undefined,
			});
		}
		return references;
	}

	/**
	 * Check if a session exists and has enough canonical/session history materialized
	 * to expose detail state. Canonical graph/open-snapshot materialization counts,
	 * locally created sessions count, and legacy preloaded provider history still
	 * counts during the migration.
	 */
	getSessionDetail(sessionId: string): SessionCold | null {
		const sessionIdentity = this.getSessionIdentity(sessionId);
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionIdentity || !sessionMetadata) {
			return null;
		}
		if (
			sessionMetadata.sessionLifecycleState !== "created" &&
			!this.hasSessionCanonicalProjection(sessionId) &&
			!this.entryStore.isPreloaded(sessionId)
		) {
			return null;
		}
		return sessionColdFromSlices(sessionIdentity, sessionMetadata);
	}

	getSessionToolCalls(sessionId: string): ToolCall[] {
		return this.operationStore.getSessionToolCalls(sessionId);
	}

	getSessionCurrentStreamingToolCall(sessionId: string): ToolCall | null {
		return this.operationStore.getCurrentStreamingToolCall(sessionId);
	}

	getSessionLastToolCall(sessionId: string): ToolCall | null {
		return this.operationStore.getLastToolCall(sessionId);
	}

	getSessionLastTodoToolCall(sessionId: string): ToolCall | null {
		return this.operationStore.getLastTodoToolCall(sessionId);
	}

	getSessionModifiedFilesState(sessionId: string): ModifiedFilesState | null {
		return this.operationStore.getSessionModifiedFilesState(sessionId);
	}

	getSessionOperationInteractionSnapshot(
		sessionId: string,
		interactions: InteractionStore
	): SessionOperationInteractionSnapshot {
		return buildSessionOperationInteractionSnapshot(sessionId, this.operationStore, interactions);
	}

	getToolCallById(sessionId: string, toolCallId: string): ToolCall | null {
		return this.operationStore.getToolCallById(sessionId, toolCallId);
	}

	isToolCallExecuting(sessionId: string, toolCallId: string): boolean {
		const operation = this.operationStore.getByToolCallId(sessionId, toolCallId);
		if (operation === undefined) {
			return false;
		}

		return (
			operation.operationState === "pending" ||
			operation.operationState === "running" ||
			operation.operationState === "blocked"
		);
	}

	getSessionCurrentToolKind(sessionId: string): ToolKind | null {
		return this.operationStore.getCurrentToolKind(sessionId);
	}

	isPermissionRepresentedByToolCall(permission: PermissionRequest, sessionId: string): boolean {
		return isPermissionRepresentedByOperation(permission, sessionId, this.operationStore);
	}

	getVisiblePermissionsForSessionBar(
		permissions: ReadonlyArray<PermissionRequest>
	): PermissionRequest[] {
		return visiblePermissionsForOperations(permissions, this.operationStore);
	}

	// ============================================
	// SESSION STATE MACHINE MANAGEMENT (delegated to connectionService)
	// ============================================

	/**
	 * Canonical composer policy for a session (config block, dispatch, selector disables).
	 * Reactive: subscribes to composer machine snapshots and canonical lifecycle presentation.
	 */
	getStoreComposerState(sessionId: string): StoreComposerState | null {
		this.transientProjectionStore.getTransientProjection(sessionId);
		const snapshot = this.composerMachineService.getState(sessionId);
		if (!snapshot) {
			return null;
		}
		const lifecyclePresentation = this.getSessionLifecyclePresentation(sessionId);
		return deriveStoreComposerState({
			machineSnapshot: snapshot,
			sessionSubmitPolicy: {
				canSubmit: lifecyclePresentation.canSubmit,
			},
		});
	}

	/**
	 * Re-seed composer committed state from transient projection (call when panel binds / session changes).
	 * Ensures the per-session actor exists before binding.
	 */
	bindComposerSession(sessionId: string): void {
		this.composerMachineService.createOrGetActor(sessionId);
		this.composerMachineService.bindSession(sessionId);
	}

	runComposerConfigOperation(
		sessionId: string,
		beginPayload: Omit<Extract<ComposerMachineEvent, { type: "CONFIG_BLOCK_BEGIN" }>, "type">,
		operation: () => Promise<boolean>
	): Promise<boolean> {
		return this.composerMachineService.runConfigOperation(sessionId, beginPayload, operation);
	}

	composerBeginDispatch(sessionId: string): void {
		this.composerMachineService.beginDispatch(sessionId);
	}

	composerEndDispatch(sessionId: string): void {
		this.composerMachineService.endDispatch(sessionId);
	}

	applySessionStateGraph(graph: SessionStateGraph): void {
		this.syncSessionSequenceFromGraph(graph);
		const previousTransientProjection = this.getTransientProjection(graph.canonicalSessionId);
		const previousProjection = this.canonicalProjections.get(graph.canonicalSessionId) ?? null;
		const preservedStreamingState = preserveCanonicalStreamingState(previousProjection);
		seedTranscriptEntryIndex(graph.transcriptSnapshot.entries);
		this.sessionStateGraphs.set(graph.canonicalSessionId, graph);
		const canonicalCapabilities = sanitizeCanonicalCapabilities(graph.capabilities);
		this.canonicalCapabilitiesMaterialized.set(graph.canonicalSessionId, true);
		const activeTurnFailure = mapProjectionTurnFailure(graph.activeTurnFailure ?? null);
		const nextLastTerminalTurnId = graph.lastTerminalTurnId ?? null;
		this.canonicalProjections.set(graph.canonicalSessionId, {
			lifecycle: graph.lifecycle,
			activity: graph.activity,
			turnState: graph.turnState,
			activeTurnFailure,
			lastTerminalTurnId: nextLastTerminalTurnId,
			activeStreamingTail: graph.activeStreamingTail ?? null,
			capabilities: canonicalCapabilities,
			tokenStream: preservedStreamingState.tokenStream,
			clockAnchor: preservedStreamingState.clockAnchor,
			revision: graph.revision,
		});
		this.applyCanonicalTerminalTurnSideEffects({
			sessionId: graph.canonicalSessionId,
			previousProjection,
			turnState: graph.turnState,
			activeTurnFailure,
			projectedFailure: graph.activeTurnFailure ?? null,
			lastTerminalTurnId: nextLastTerminalTurnId,
		});

		const updates: SessionTransientProjectionUpdates = {
			acpSessionId: graph.lifecycle.status === "ready" ? graph.canonicalSessionId : null,
			capabilityMutationState: {
				pendingMutationId: null,
				previewState: deriveCapabilityPreviewState(canonicalCapabilities),
			},
		};
		if (previousProjection?.lifecycle.status !== graph.lifecycle.status) {
			updates.statusChangedAt = Date.now();
		}
		if (
			previousTransientProjection.pendingSendIntent !== null &&
			previousTransientProjection.pendingSendIntent !== undefined &&
			transcriptSnapshotAcknowledgesPendingSend(
				graph.transcriptSnapshot,
				previousTransientProjection.pendingSendIntent
			)
		) {
			updates.pendingSendIntent = null;
		}
		if (previousTransientProjection.autonomousTransition !== "idle") {
			updates.autonomousTransition = "idle";
		}

		this.transientProjectionStore.updateTransientProjection(graph.canonicalSessionId, updates);
		this.reconcileConnectionMachineFromCanonicalState(
			graph.canonicalSessionId,
			graph.lifecycle,
			graph.turnState,
			activeTurnFailure
		);
	}

	private applyCanonicalTerminalTurnSideEffects(input: {
		sessionId: string;
		previousProjection: CanonicalSessionProjection | null;
		turnState: SessionTurnState;
		activeTurnFailure: ActiveTurnFailure | null;
		projectedFailure: TurnFailureSnapshot | null;
		lastTerminalTurnId: string | null;
	}): void {
		const isNewCompletedTurn =
			input.previousProjection !== null &&
			input.turnState === "Completed" &&
			(input.previousProjection?.turnState !== "Completed" ||
				input.previousProjection.lastTerminalTurnId !== input.lastTerminalTurnId);
		const isNewFailedTurn =
			input.previousProjection !== null &&
			input.turnState === "Failed" &&
			input.activeTurnFailure !== null &&
			(input.previousProjection?.turnState !== "Failed" ||
				input.previousProjection.lastTerminalTurnId !== input.lastTerminalTurnId);
		if (isNewCompletedTurn) {
			this.composerEndDispatch(input.sessionId);
			this.messagingSvc.handleCanonicalTurnComplete(
				input.sessionId,
				input.lastTerminalTurnId ?? undefined
			);
			this.callbacks.onTurnComplete?.(input.sessionId);
			void this.refreshSessionStateSnapshot(input.sessionId).match(
				() => undefined,
				() => undefined
			);
		}

		if (!isNewFailedTurn || input.projectedFailure === null) {
			return;
		}

		this.composerEndDispatch(input.sessionId);
		const numericCode =
			input.projectedFailure.code == null || input.projectedFailure.code.trim() === ""
				? undefined
				: Number.isNaN(Number(input.projectedFailure.code))
					? undefined
					: Number(input.projectedFailure.code);
		this.messagingSvc.handleCanonicalTurnFailure(input.sessionId, {
			type: "turnError",
			session_id: input.sessionId,
			turn_id: input.projectedFailure.turn_id ?? undefined,
			error: {
				message: input.projectedFailure.message,
				code: numericCode,
				kind: input.projectedFailure.kind,
				source: input.projectedFailure.source ?? "unknown",
			},
		});
		this.callbacks.onTurnError?.(input.sessionId);
	}

	private reconcileConnectionMachineFromCanonicalState(
		sessionId: string,
		lifecycle: SessionGraphLifecycle,
		turnState: SessionTurnState,
		activeTurnFailure: ActiveTurnFailure | null
	): void {
		this.connectionService.syncFromCanonicalState(
			sessionId,
			lifecycle,
			turnState,
			activeTurnFailure
		);
	}

	// ============================================
	// SESSION LOADING STATUS
	// ============================================

	/**
	 * Set session status to loading (for async content loading).
	 */
	setSessionLoading(sessionId: string): void {
		this.connectionService.sendContentLoad(sessionId);
	}

	/**
	 * Mark session as loaded after persisted history entries have been fetched.
	 */
	setSessionLoaded(sessionId: string): void {
		this.connectionService.sendContentLoaded(sessionId);
	}

	setLocalCreatedSessionLoaded(sessionId: string): void {
		this.connectionService.sendContentLoad(sessionId);
		this.connectionService.sendContentLoaded(sessionId);
		this.setSessionLoaded(sessionId);
	}

	// ============================================
	// SESSION CRUD (ISessionStateWriter implementation + delegation to repository)
	// ============================================

	/**
	 * Add a session to the store.
	 */
	addSession(session: SessionCold): void {
		this.listState.addSession(session);
	}

	/**
	 * Remove a session from the store.
	 * Used to clean up orphaned sessions (metadata exists but content is missing).
	 */
	removeSession(sessionId: string): void {
		this.repository.removeSession(sessionId);
		this.transientProjectionStore.removeTransientProjection(sessionId);
		this.canonicalProjections.delete(sessionId);
		this.sessionStateGraphs.delete(sessionId);
		this.viewport.removeSession(sessionId);
		this.canonicalCapabilitiesMaterialized.delete(sessionId);
		this.rowTokenStreamsByRowId.delete(sessionId);
		this.messagingSvc.clearSessionState(sessionId);
		this.composerMachineService.removeMachine(sessionId);
		preferencesStore.clearSessionModelPerMode(sessionId);
		for (const cb of this.onRemoveCallbacks) {
			cb(sessionId);
		}
	}

	/**
	 * Clear cached entries and graph projection for a session without removing metadata.
	 * Used to force a fresh reload from persisted provider history for historical sessions.
	 */
	clearSessionEntries(sessionId: string): void {
		this.entryStore.clearEntries(sessionId);
		this.sessionStateGraphs.delete(sessionId);
		this.rowTokenStreamsByRowId.delete(sessionId);
		this.messagingSvc.clearSessionState(sessionId);
	}

	replaceSessionOpenSnapshot(snapshot: SessionOpenFound): void {
		const canonicalSessionId = snapshot.canonicalSessionId;
		const requestedSessionId = snapshot.requestedSessionId;
		const aliasSessionIdentity =
			snapshot.isAlias && requestedSessionId !== canonicalSessionId
				? this.getSessionIdentity(requestedSessionId)
				: undefined;
		const aliasSessionMetadata =
			snapshot.isAlias && requestedSessionId !== canonicalSessionId
				? this.getSessionMetadata(requestedSessionId)
				: undefined;
		const aliasSession =
			aliasSessionIdentity && aliasSessionMetadata
				? sessionColdFromSlices(aliasSessionIdentity, aliasSessionMetadata)
				: undefined;
		const canonicalSessionIdentity = this.getSessionIdentity(canonicalSessionId);
		const canonicalSessionMetadata = this.getSessionMetadata(canonicalSessionId);
		const canonicalSession =
			canonicalSessionIdentity && canonicalSessionMetadata
				? sessionColdFromSlices(canonicalSessionIdentity, canonicalSessionMetadata)
				: undefined;
		const preservedSession = canonicalSession ?? aliasSession;
		const now = new Date();
		const nextSessionLifecycleState =
			snapshot.sourcePath !== null
				? "persisted"
				: (preservedSession?.sessionLifecycleState ?? "created");

		if (aliasSession && requestedSessionId !== canonicalSessionId) {
			this.removeSession(requestedSessionId);
		}

		const snapshotSession = sessionColdFromOpenSnapshotInput({
			id: canonicalSessionId,
			projectPath: snapshot.projectPath,
			agentId: canonicalAgentIdToString(snapshot.agentId),
			worktreePath: snapshot.worktreePath ?? undefined,
			title: snapshot.sessionTitle,
			updatedAt: preservedSession?.updatedAt ?? now,
			createdAt: preservedSession?.createdAt ?? now,
			sourcePath: snapshot.sourcePath ?? undefined,
			sessionLifecycleState: nextSessionLifecycleState,
			parentId: preservedSession?.parentId ?? null,
			sequenceId: snapshot.sequenceId ?? null,
			preservedMetadata: preservedSession,
		});

		if (canonicalSession) {
			this.listState.applyOpenSnapshotToList(canonicalSession, snapshotSession);
		} else {
			this.addSession(snapshotSession);
		}

		this.operationStore.replaceSessionOperations(canonicalSessionId, snapshot.operations);
		this.entryStore.replaceTranscriptSnapshot(canonicalSessionId, snapshot.transcriptSnapshot, now);
		this.transientProjectionStore.initializeTransientProjection(canonicalSessionId);
		const graph = materializeSnapshotFromOpenFound(snapshot).graph;
		seedTranscriptEntryIndex(graph.transcriptSnapshot.entries);
		this.sessionStateGraphs.set(canonicalSessionId, graph);
		const canonicalCapabilities = sanitizeCanonicalCapabilities(graph.capabilities);
		this.canonicalCapabilitiesMaterialized.set(canonicalSessionId, true);
		this.transientProjectionStore.updateTransientProjection(canonicalSessionId, {
			statusChangedAt: Date.now(),
			capabilityMutationState: {
				pendingMutationId: null,
				previewState: deriveCapabilityPreviewState(canonicalCapabilities),
			},
		});
		const preservedStreamingState = preserveCanonicalStreamingState(
			this.canonicalProjections.get(canonicalSessionId) ?? null
		);
		// Populate canonical projection from the backend-authored open snapshot
		// so downstream readers never synthesize lifecycle from local transient projection.
		this.canonicalProjections.set(canonicalSessionId, {
			lifecycle: graph.lifecycle,
			activity: graph.activity,
			turnState: snapshot.turnState,
			activeTurnFailure: mapProjectionTurnFailure(snapshot.activeTurnFailure ?? null),
			lastTerminalTurnId: snapshot.lastTerminalTurnId ?? null,
			activeStreamingTail: graph.activeStreamingTail ?? null,
			capabilities: canonicalCapabilities,
			tokenStream: preservedStreamingState.tokenStream,
			clockAnchor: preservedStreamingState.clockAnchor,
			revision: graph.revision,
		});
		this.connectionService.sendContentLoad(canonicalSessionId);
		this.connectionService.sendContentLoaded(canonicalSessionId);
	}

	ensureSessionFromStateGraph(graph: SessionStateGraph): boolean {
		const sessionId = graph.canonicalSessionId;
		if (this.getSessionIdentity(sessionId)) {
			this.syncSessionSequenceFromGraph(graph);
			this.pendingCreationSessions.delete(sessionId);
			if (graph.isAlias) {
				this.pendingCreationSessions.delete(graph.requestedSessionId);
			}
			return true;
		}

		const pendingCreation =
			this.pendingCreationSessions.get(sessionId) ??
			(graph.isAlias ? (this.pendingCreationSessions.get(graph.requestedSessionId) ?? null) : null);
		if (pendingCreation === null) {
			return false;
		}

		const now = new Date();
		this.addSession({
			id: sessionId,
			projectPath: graph.projectPath,
			agentId: canonicalAgentIdToString(graph.agentId),
			worktreePath: graph.worktreePath ?? undefined,
			title: pendingCreation.title ?? "New Thread",
			updatedAt: now,
			createdAt: now,
			sourcePath: graph.sourcePath ?? undefined,
			sequenceId: graph.sequenceId ?? undefined,
			sessionLifecycleState: graph.sourcePath ? "persisted" : "created",
			parentId: null,
		});
		this.pendingCreationSessions.delete(sessionId);
		if (graph.isAlias) {
			this.pendingCreationSessions.delete(graph.requestedSessionId);
		}
		return true;
	}

	private syncSessionSequenceFromGraph(graph: SessionStateGraph): void {
		if (graph.sequenceId === null || graph.sequenceId === undefined) {
			return;
		}
		const metadata = this.getSessionMetadata(graph.canonicalSessionId);
		if (metadata === undefined || metadata.sequenceId != null) {
			return;
		}
		this.updateSession(
			graph.canonicalSessionId,
			{
				sequenceId: graph.sequenceId,
			},
			{ touchUpdatedAt: false }
		);
	}

	failPendingCreationSession(sessionId: string, update: TurnErrorUpdate): void {
		if (!this.pendingCreationSessions.has(sessionId)) {
			return;
		}
		// GOD authority: Rust emits a canonical Lifecycle(Failed) envelope when
		// TurnError arrives for an unregistered session (build_snapshot_envelope
		// fallback in runtime_registry.rs). The canonical channel is the sole
		// authority — no client synthesis needed.
		this.messagingSvc.handleCanonicalTurnFailure(sessionId, update);
		this.pendingCreationSessions.delete(sessionId);
		this.callbacks.onTurnError?.(sessionId);
	}

	/**
	 * Register a callback to run when a session is removed.
	 * Used by external stores (e.g., PlanStore) for cleanup.
	 */
	onSessionRemoved(callback: (sessionId: string) => void): void {
		this.onRemoveCallbacks.push(callback);
	}

	/**
	 * Update a session's cold data by ID (creates new array for reactivity).
	 */
	updateSession(
		id: string,
		updates: SessionMutableColdUpdates,
		options?: { touchUpdatedAt?: boolean }
	): void {
		this.listState.updateSession(id, updates, options);
	}

	renameSession(sessionId: string, title: string): ResultAsync<void, AppError> {
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionMetadata) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const trimmedTitle = title.trim();
		if (trimmedTitle === "" || trimmedTitle === sessionMetadata.title) {
			return okAsync(undefined);
		}

		return api.setSessionTitle(sessionId, trimmedTitle).map(() => {
			this.updateSession(
				sessionId,
				{
					title: trimmedTitle,
				},
				{ touchUpdatedAt: false }
			);
			return undefined;
		});
	}

	// ============================================
	// SESSION LOADING (delegated to repository)
	// ============================================

	/**
	 * Load sessions from history (from ALL agents).
	 */
	loadSessions(projectPaths?: string[]): ResultAsync<SessionCold[], AppError> {
		return this.repository.loadSessions(this.sessions, projectPaths).map((sessions) => {
			// After loading, refresh PR states from GitHub for all sessions with a PR number.
			// Fire-and-forget — sidebar badges update as each fetch completes.
			this.refreshAllPrStates();
			return sessions;
		});
	}

	/**
	 * Scan project sessions from all agents and refresh the store.
	 */
	scanSessions(projectPaths: string[]): ResultAsync<void, AppError> {
		return this.repository.scanSessions(this.sessions, projectPaths).map(() => {
			this.refreshAllPrStates();
		});
	}

	/**
	 * Refresh sessions from a batch scan result.
	 */
	refreshSessionsFromScan(entries: HistoryEntry[]): void {
		this.repository.refreshSessionsFromScan(this.sessions, entries);
	}

	/**
	 * Load startup sessions (hydrate sessions that should be open at startup).
	 */
	loadStartupSessions(
		sessionIds: string[]
	): ResultAsync<{ missing: string[]; aliasRemaps: Record<string, string> }, AppError> {
		return this.repository.loadStartupSessions(this.sessions, sessionIds);
	}

	/**
	 * Preload full session details from persisted provider history.
	 */
	preloadSessions(
		sessionIds: string[]
	): ResultAsync<{ loaded: SessionCold[]; missing: string[] }, AppError> {
		return this.repository.preloadSessions(sessionIds);
	}

	/**
	 * Register a minimal cold-shell so that openPersistedSession can find session
	 * metadata when the session is only present in the backend registry (not yet in the
	 * local store). The canonical provider-open snapshot is applied by the subsequent
	 * openPersistedSession call; this method only seeds the lookup.
	 *
	 * No-op when the session is already registered.
	 */
	registerSessionPlaceholder(
		sessionId: string,
		projectPath: string,
		agentId: string,
		options?: {
			sourcePath?: string;
			worktreePath?: string;
			placeholderTitle?: string | null;
		}
	): void {
		if (this.getSessionIdentity(sessionId)) {
			return;
		}
		const now = new Date();
		this.addSession({
			id: sessionId,
			projectPath,
			agentId,
			worktreePath: options?.worktreePath,
			title: options?.placeholderTitle ?? null,
			updatedAt: now,
			createdAt: now,
			sourcePath: options?.sourcePath,
			sessionLifecycleState: options?.sourcePath ? "persisted" : "created",
			parentId: null,
		});
	}

	/**
	 * Load a historical session from persisted provider history metadata.
	 */
	loadHistoricalSession(
		id: string,
		projectPath: string,
		title: string,
		agentId: string,
		sourcePath?: string,
		sequenceId?: number,
		worktreePath?: string
	): ResultAsync<SessionCold, AppError> {
		return this.repository.loadHistoricalSession(
			id,
			projectPath,
			title,
			agentId,
			sourcePath,
			sequenceId,
			undefined,
			worktreePath
		);
	}

	// ============================================
	// SESSION CONNECTION (delegated to connection manager)
	// ============================================

	/**
	 * Create a new session and seed store state before ACP activation materializes.
	 */
	createSession(options: {
		projectPath: string;
		agentId: string;
		title?: string;
		initialAutonomousEnabled?: boolean;
		initialModeId?: string;
		initialModelId?: string;
		worktreePath?: string;
		launchToken?: string;
	}): ResultAsync<SessionCreationResult, AppError> {
		return this.connectionMgr.createSession(options, this).andThen((createdSession) => {
			if (createdSession.kind === "pending") {
				this.pendingCreationSessions.set(createdSession.sessionId, createdSession);
				return okAsync(createdSession);
			}

			if (this.sessionOpenHydrator !== null && createdSession.sessionOpen?.outcome === "found") {
				return this.sessionOpenHydrator.hydrateCreated(createdSession.sessionOpen).map(() => ({
					kind: "ready" as const,
					session: createdSession.session,
				}));
			}

			return okAsync({
				kind: "ready" as const,
				session: createdSession.session,
			});
		});
	}

	setSessionOpenHydrator(hydrator: CreatedSessionHydrator): void {
		this.sessionOpenHydrator = hydrator;
	}

	setLiveSessionStateGraphConsumer(consumer: LiveSessionStateGraphConsumer): void {
		this.liveSessionStateGraphConsumer = consumer;
	}

	/**
	 * Connect to a session (resume or create ACP connection).
	 */
	connectSession(
		sessionId: string,
		options?: { openToken?: string; forceReconnect?: boolean }
	): ResultAsync<SessionCold, AppError> {
		return this.connectionMgr.connectSession(sessionId, this, options);
	}

	/**
	 * Disconnect a session.
	 */
	disconnectSession(sessionId: string): void {
		this.connectionMgr.disconnectSession(sessionId);
		this.messagingSvc.clearSessionState(sessionId);
		this.awaitingModelRefresh.clearAwaitingModelRefreshTimer(sessionId);
		this.viewport.clearReattachWatchdog(sessionId);
	}

	/**
	 * Disconnect all connected sessions.
	 * Used for cleanup when the app window closes.
	 */
	disconnectAllSessions(): void {
		const connectedSessions = this.sessions.filter((s) => this.getSessionCanSend(s.id) === true);
		for (const session of connectedSessions) {
			this.disconnectSession(session.id);
		}
		this.awaitingModelRefresh.clearAllAwaitingModelRefreshTimers();
	}

	// ============================================
	// MODEL/MODE (delegated to connection manager)
	// ============================================

	/**
	 * Set model for a session (optimistic update with rollback).
	 */
	setModel(sessionId: string, modelId: string): ResultAsync<void, AppError> {
		return this.connectionMgr.setModel(sessionId, modelId);
	}

	/**
	 * Set mode for a session (optimistic update with rollback).
	 */
	setMode(sessionId: string, modeId: string): ResultAsync<void, AppError> {
		return this.connectionMgr.setMode(sessionId, modeId);
	}

	setAutonomousEnabled(sessionId: string, enabled: boolean): ResultAsync<void, AppError> {
		return this.connectionMgr.setAutonomousEnabled(sessionId, enabled, this);
	}

	setConfigOption(sessionId: string, configId: string, value: string): ResultAsync<void, AppError> {
		return this.connectionMgr.setConfigOption(sessionId, configId, value);
	}

	/**
	 * Cancel streaming for a session.
	 */
	cancelStreaming(sessionId: string): ResultAsync<void, AppError> {
		return this.connectionMgr.cancelStreaming(sessionId).map(() => {
			this.callbacks.onTurnInterrupted?.(sessionId);
			return undefined;
		});
	}

	// ============================================
	// MESSAGING (delegated to messaging service)
	// ============================================

	/**
	 * Send a message to a session.
	 */
	sendMessage(
		sessionId: string,
		content: string,
		attachments: readonly Attachment[] = []
	): ResultAsync<void, AppError> {
		const sessionIdentity = this.getSessionIdentity(sessionId);
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionIdentity) {
			if (this.pendingCreationSessions.has(sessionId)) {
				return this.messagingSvc
					.sendPendingCreationMessage(sessionId, content, attachments)
					.mapErr((error) => {
						this.pendingCreationSessions.delete(sessionId);
						return error;
					});
			}
			return errAsync(new SessionNotFoundError(sessionId));
		}
		if (!sessionMetadata) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const canonicalCanSend = this.getSessionCanSend(sessionId);
		logger.info("sendMessage: store entrypoint", {
			sessionId,
			canSend: canonicalCanSend,
			transcriptRevisionBeforeSend: this.getGraphTranscriptRevision(sessionId) ?? null,
			preview: content.trim().slice(0, 120),
		});

		const send = () =>
			this.messagingSvc.sendMessage(sessionId, content, attachments).map(() => {
				const currentTitle = this.getSessionMetadata(sessionId)?.title;
				logger.debug("[sendMessage] After message sent, checking title update", {
					sessionId,
					currentTitle: currentTitle?.substring(0, 100),
				});
				if (!currentTitle) {
					logger.debug("[sendMessage] No current title, skipping title update");
					return;
				}

				const derivedTitle = getTitleUpdateFromUserMessage(currentTitle, content);
				logger.debug("[sendMessage] Title derivation result", {
					derivedTitle,
					willUpdate: !!derivedTitle,
				});
				if (!derivedTitle) {
					logger.debug("[sendMessage] No derived title, skipping update");
					return;
				}

				logger.debug("[sendMessage] Updating session title", { derivedTitle });
				this.updateSession(sessionId, { title: derivedTitle });
			});

		const canSend = canonicalCanSend === true;
		const lifecycleStatus = this.getSessionLifecycleStatus(sessionId);
		const canActivateFirstPrompt = canActivateCreatedSessionWithFirstPrompt({
			sessionMetadata,
			lifecycleStatus,
		});

		if (canSend || canActivateFirstPrompt) {
			return send();
		}
		return errAsync(new ConnectionError(sessionId));
	}

	// ============================================
	// PR LINKING + STATE REFRESH  (delegated to PrLinkStateStore, ADR-0002)
	// ============================================

	updateSessionPrLink(sessionId: string, projectPath: string, prNumber: number | null, prLinkMode: SessionPrLinkMode): ResultAsync<void, AppError> {
		return this.prLinkState.updateSessionPrLink(sessionId, projectPath, prNumber, prLinkMode);
	}

	restoreAutomaticSessionPrLink(sessionId: string, projectPath: string): ResultAsync<void, AppError> {
		return this.prLinkState.restoreAutomaticSessionPrLink(sessionId, projectPath);
	}

	applyAutomaticPrLinkFromShipWorkflow(sessionId: string, projectPath: string, pr: GitStackedPrStep): ResultAsync<number | null, never> {
		return this.prLinkState.applyAutomaticPrLinkFromShipWorkflow(sessionId, projectPath, pr);
	}

	invalidatePrDetails(projectPath: string, prNumber: number): void {
		this.prLinkState.invalidatePrDetails(projectPath, prNumber);
	}

	invalidatePrChecks(projectPath: string, prNumber: number): void {
		this.prLinkState.invalidatePrChecks(projectPath, prNumber);
	}

	registerVisiblePrChecksSurface(projectPath: string, prNumber: number, surfaceId: string): () => void {
		return this.prLinkState.registerVisiblePrChecksSurface(projectPath, prNumber, surfaceId);
	}

	refreshSessionPrChecks(sessionId: string, projectPath: string, prNumber: number, options?: { force?: boolean }): ResultAsync<PrChecks | null, never> {
		return this.prLinkState.refreshSessionPrChecks(sessionId, projectPath, prNumber, options);
	}

	refreshSessionPrState(sessionId: string, projectPath: string, prNumber: number): ResultAsync<PrDetails | null, never> {
		return this.prLinkState.refreshSessionPrState(sessionId, projectPath, prNumber);
	}

	refreshAllPrStates(): void {
		this.prLinkState.refreshAllPrStates();
	}

	updateUsageTelemetry(
		sessionId: string,
		telemetry: import("./types.js").SessionUsageTelemetry
	): void {
		this.transientProjectionStore.updateTransientProjection(sessionId, {
			usageTelemetry: telemetry,
		});
	}

	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void {
		const commands = routeSessionStateEnvelope(
			sessionId,
			this.getGraphRevision(sessionId),
			envelope
		);

		for (const command of commands) {
			if (command.kind === "rejectOversizedEnvelope") {
				logger.warn("Rejected oversized session-state envelope", {
					sessionId,
					kind: command.budget.kind,
					byteLength: command.budget.byteLength,
					maxBytes: command.budget.maxBytes,
				});
				continue;
			}

			if (command.kind === "rejectSessionMismatch") {
				logger.warn("Rejected session-state envelope for another session", {
					sessionId,
					envelopeSessionId: command.envelopeSessionId,
					expectedSessionId: command.expectedSessionId,
				});
				continue;
			}

			if (command.kind === "replaceGraph") {
				const graph = command.graph;
				const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				const currentRevision = previousProjection?.revision ?? previousGraph?.revision ?? null;
				if (!isNewerGraphRevision(currentRevision, graph.revision)) {
					logger.debug("Ignoring stale session-state graph snapshot", {
						sessionId,
						currentRevision,
						incomingRevision: graph.revision,
					});
					continue;
				}
				const currentTranscriptRevision = previousGraph?.transcriptSnapshot.revision;
				const incomingTranscriptRevision = graph.transcriptSnapshot.revision;
				const shouldReplaceTranscriptSnapshot =
					currentTranscriptRevision === undefined ||
					incomingTranscriptRevision > currentTranscriptRevision;
				const operationGraph = graph;
				this.operationStore.replaceSessionOperations(sessionId, operationGraph.operations);
				if (shouldReplaceTranscriptSnapshot) {
					this.entryStore.replaceTranscriptSnapshot(
						sessionId,
						operationGraph.transcriptSnapshot,
						new Date()
					);
				} else {
					logger.debug("Ignoring non-advancing session-state transcript snapshot", {
						sessionId,
						currentTranscriptRevision,
						incomingTranscriptRevision,
						graphRevision: graph.revision.graphRevision,
						lastEventSeq: graph.revision.lastEventSeq,
					});
				}
				const projectionGraph =
					shouldReplaceTranscriptSnapshot ||
					currentTranscriptRevision === undefined ||
					previousGraph === null
						? operationGraph
						: graphWithTranscriptSnapshot(operationGraph, previousGraph.transcriptSnapshot);
				this.liveSessionStateGraphConsumer?.replaceSessionStateGraph(projectionGraph);
				this.applySessionStateGraph(projectionGraph);
				this.awaitingModelRefresh.syncAwaitingModelRefreshTimer(
					sessionId,
					projectionGraph.activity,
					projectionGraph.turnState
				);
				continue;
			}

			if (command.kind === "applyLifecycle") {
				const transientProjection = this.getTransientProjection(sessionId);
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				const previousCapabilitiesMaterialized =
					this.canonicalCapabilitiesMaterialized.get(sessionId) === true;
				const preservedStreamingState = preserveCanonicalStreamingState(previousProjection);
				const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
				// Carry forward canonical turnState and activeTurnFailure from the previous full-graph
				// projection. Reading these from local transient projection would feed optimistic messaging-service writes
				// back into the canonical projection (authority inversion).
				const turnState = previousProjection?.turnState ?? "Idle";
				const activeTurnFailure = previousProjection?.activeTurnFailure ?? null;
				const graphActiveTurnFailure = previousGraph?.activeTurnFailure ?? null;
				const reconciledActivity = reconcileStoredGraphActivity(
					previousProjection?.activity ?? null,
					command.lifecycle,
					turnState,
					activeTurnFailure
				) ?? {
					kind: "idle",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				};
				const lifecycleRevision = command.revision;
				if (isOlderGraphRevision(previousProjection?.revision ?? null, lifecycleRevision)) {
					logger.debug("Ignoring stale session-state lifecycle envelope", {
						sessionId,
						currentRevision: previousProjection?.revision ?? null,
						incomingRevision: lifecycleRevision,
					});
					continue;
				}
				this.canonicalProjections.set(sessionId, {
					lifecycle: command.lifecycle,
					activity: reconciledActivity,
					turnState,
					activeTurnFailure,
					lastTerminalTurnId: previousProjection?.lastTerminalTurnId ?? null,
					activeStreamingTail: previousProjection?.activeStreamingTail ?? null,
					capabilities: previousProjection?.capabilities ?? emptySessionGraphCapabilities(),
					tokenStream: preservedStreamingState.tokenStream,
					clockAnchor: preservedStreamingState.clockAnchor,
					revision: lifecycleRevision,
				});
				this.canonicalCapabilitiesMaterialized.set(sessionId, previousCapabilitiesMaterialized);
				if (previousGraph !== null) {
					this.sessionStateGraphs.set(
						sessionId,
						graphWithLifecycle(
							previousGraph,
							command.lifecycle,
							reconciledActivity,
							lifecycleRevision
						)
					);
				} else {
					const sessionIdentity = this.getSessionIdentity(sessionId);
					const sessionMetadata = this.getSessionMetadata(sessionId);
					this.sessionStateGraphs.set(
						sessionId,
						createLifecycleOnlyGraph({
							sessionId,
							session:
								sessionIdentity && sessionMetadata
									? sessionColdFromSlices(sessionIdentity, sessionMetadata)
									: undefined,
							lifecycle: command.lifecycle,
							activity: reconciledActivity,
							turnState,
							activeTurnFailure: graphActiveTurnFailure,
							lastTerminalTurnId: previousProjection?.lastTerminalTurnId ?? null,
							capabilities: previousProjection?.capabilities ?? emptySessionGraphCapabilities(),
							revision: lifecycleRevision,
						})
					);
				}
				const updates: SessionTransientProjectionUpdates = {
					acpSessionId:
						command.lifecycle.status === "ready" ? sessionId : transientProjection.acpSessionId,
				};
				if (previousProjection?.lifecycle.status !== command.lifecycle.status) {
					updates.statusChangedAt = Date.now();
				}
				if (
					transientProjection.pendingSendIntent !== null &&
					transientProjection.pendingSendIntent !== undefined &&
					previousGraph !== null &&
					transcriptSnapshotAcknowledgesPendingSend(
						previousGraph.transcriptSnapshot,
						transientProjection.pendingSendIntent
					)
				) {
					updates.pendingSendIntent = null;
				}
				this.transientProjectionStore.updateTransientProjection(sessionId, updates);
				this.reconcileConnectionMachineFromCanonicalState(
					sessionId,
					command.lifecycle,
					turnState,
					activeTurnFailure
				);
				this.awaitingModelRefresh.syncAwaitingModelRefreshTimer(sessionId, reconciledActivity, turnState);
				continue;
			}

			if (command.kind === "applyCapabilities") {
				const sessionIdentity = this.getSessionIdentity(sessionId);
				if (!sessionIdentity) {
					continue;
				}
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				if (isOlderGraphRevision(previousProjection?.revision ?? null, command.revision)) {
					continue;
				}
				const preservedStreamingState = preserveCanonicalStreamingState(previousProjection);
				const canonicalCapabilities = sanitizeCanonicalCapabilities(command.capabilities);
				this.canonicalCapabilitiesMaterialized.set(sessionId, true);
				if (previousProjection !== null) {
					this.canonicalProjections.set(sessionId, {
						lifecycle: previousProjection.lifecycle,
						activity: previousProjection.activity,
						turnState: previousProjection.turnState,
						activeTurnFailure: previousProjection.activeTurnFailure,
						lastTerminalTurnId: previousProjection.lastTerminalTurnId,
						activeStreamingTail: previousProjection.activeStreamingTail,
						capabilities: canonicalCapabilities,
						tokenStream: preservedStreamingState.tokenStream,
						clockAnchor: preservedStreamingState.clockAnchor,
						revision: command.revision,
					});
				}
				const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
				if (previousGraph !== null) {
					this.sessionStateGraphs.set(
						sessionId,
						graphWithCapabilities(previousGraph, canonicalCapabilities, command.revision)
					);
				}
				const transientProjection = this.getTransientProjection(sessionId);
				const updates: SessionTransientProjectionUpdates = {
					capabilityMutationState: {
						pendingMutationId: command.pendingMutationId,
						previewState: command.previewState,
					},
				};
				if (transientProjection.autonomousTransition !== "idle") {
					updates.autonomousTransition = "idle";
				}
				this.transientProjectionStore.updateTransientProjection(sessionId, updates);
				continue;
			}

			if (command.kind === "applyTelemetry") {
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				if (!isNewerGraphRevision(previousProjection?.revision ?? null, command.revision)) {
					logger.debug("Ignoring stale session-state telemetry envelope", {
						sessionId,
						currentRevision: previousProjection?.revision ?? null,
						incomingRevision: command.revision,
					});
					continue;
				}
				const transientProjection = this.getTransientProjection(sessionId);
				const nextTelemetry = buildCanonicalUsageTelemetry(
					command.telemetry,
					transientProjection.usageTelemetry,
					this.getSessionCurrentModelId(sessionId)
				);
				if (nextTelemetry !== null) {
					this.updateUsageTelemetry(sessionId, nextTelemetry);
				}
				continue;
			}

			if (command.kind === "applyPlan") {
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				if (!isNewerGraphRevision(previousProjection?.revision ?? null, command.revision)) {
					logger.debug("Ignoring stale session-state plan envelope", {
						sessionId,
						currentRevision: previousProjection?.revision ?? null,
						incomingRevision: command.revision,
					});
					continue;
				}
				this.callbacks.onPlanUpdate?.(sessionId, command.plan);
				continue;
			}

			if (command.kind === "applyAssistantTextDelta") {
				this.applyAssistantTextDelta(sessionId, command.delta);
				continue;
			}

			if (command.kind === "applyBufferPush") {
				this.viewport.applyBufferPush(command.push);
				continue;
			}

			if (command.kind === "applyBufferDelta") {
				this.viewport.applyBufferDelta(command.delta);
				continue;
			}

			if (command.kind === "applyGraphPatches") {
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				if (previousProjection === null) {
					logger.warn("Received session-state graph patches before canonical projection", {
						sessionId,
						revision: command.revision,
					});
					void this.refreshSessionStateSnapshot(sessionId).match(
						() => undefined,
						() => undefined
					);
					continue;
				}
				if (!isNewerGraphRevision(previousProjection.revision, command.revision)) {
					logger.debug("Ignoring stale session-state graph patch", {
						sessionId,
						currentRevision: previousProjection.revision,
						incomingRevision: command.revision,
					});
					continue;
				}
				const preservedStreamingState = preserveCanonicalStreamingState(previousProjection);
				this.operationStore.applySessionOperationPatches(sessionId, command.operationPatches);
				this.liveSessionStateGraphConsumer?.applySessionInteractionPatches?.(
					command.interactionPatches
				);
				const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
				if (previousGraph !== null) {
					this.sessionStateGraphs.set(
						sessionId,
						graphWithPatches({
							graph: previousGraph,
							revision: command.revision,
							activity: command.activity,
							turnState: command.turnState,
							activeTurnFailure: command.activeTurnFailure,
							lastTerminalTurnId: command.lastTerminalTurnId,
							activeStreamingTail: command.activeStreamingTail,
							operationPatches: command.operationPatches,
							interactionPatches: command.interactionPatches,
						})
					);
				}
				const activeTurnFailure =
					command.activeTurnFailure === undefined
						? previousProjection.activeTurnFailure
						: mapProjectionTurnFailure(command.activeTurnFailure);
				const nextActivity = command.activity ?? previousProjection.activity;
				const nextTurnState = command.turnState ?? previousProjection.turnState;
				const nextLastTerminalTurnId =
					command.lastTerminalTurnId === undefined
						? previousProjection.lastTerminalTurnId
						: command.lastTerminalTurnId;
				this.canonicalProjections.set(sessionId, {
					lifecycle: previousProjection.lifecycle,
					activity: nextActivity,
					turnState: nextTurnState,
					activeTurnFailure,
					lastTerminalTurnId: nextLastTerminalTurnId,
					activeStreamingTail:
						command.activeStreamingTail === undefined
							? previousProjection.activeStreamingTail
							: command.activeStreamingTail,
					capabilities: previousProjection.capabilities,
					tokenStream: preservedStreamingState.tokenStream,
					clockAnchor: preservedStreamingState.clockAnchor,
					revision: command.revision,
				});
				const transientProjection = this.getTransientProjection(sessionId);
				const updates: SessionTransientProjectionUpdates = {};
				if (
					transientProjection.pendingSendIntent !== null &&
					transientProjection.pendingSendIntent !== undefined &&
					previousGraph !== null &&
					transcriptSnapshotAcknowledgesPendingSend(
						previousGraph.transcriptSnapshot,
						transientProjection.pendingSendIntent
					)
				) {
					updates.pendingSendIntent = null;
				}
				this.transientProjectionStore.updateTransientProjection(sessionId, updates);
				this.applyCanonicalTerminalTurnSideEffects({
					sessionId,
					previousProjection,
					turnState: nextTurnState,
					activeTurnFailure,
					projectedFailure: command.activeTurnFailure ?? null,
					lastTerminalTurnId: nextLastTerminalTurnId,
				});
				this.reconcileConnectionMachineFromCanonicalState(
					sessionId,
					previousProjection.lifecycle,
					nextTurnState,
					activeTurnFailure
				);
				this.awaitingModelRefresh.syncAwaitingModelRefreshTimer(sessionId, nextActivity, nextTurnState);
				continue;
			}

			if (command.kind === "refreshSnapshot") {
				logger.warn("Refreshing session-state snapshot for transcript frontier mismatch", {
					sessionId,
					currentRevision: this.getGraphTranscriptRevision(sessionId),
					fromRevision: command.fromRevision,
					toRevision: command.toRevision,
				});
				void this.refreshSessionStateSnapshot(sessionId).match(
					() => undefined,
					() => undefined
				);
				continue;
			}

			this.applyTranscriptDelta(sessionId, command.delta, command.revision);
		}
	}

	applyTranscriptDelta(
		sessionId: string,
		delta: TranscriptDelta,
		revision?: SessionGraphRevision
	): void {
		const currentTranscriptRevision = this.getGraphTranscriptRevision(sessionId);
		let nextSnapshot: TranscriptSnapshot | null = null;
		if (
			currentTranscriptRevision === undefined ||
			delta.snapshotRevision > currentTranscriptRevision
		) {
			const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
			if (previousGraph !== null) {
				nextSnapshot = applyTranscriptDeltaToSnapshot(
					previousGraph.transcriptSnapshot,
					delta
				);
				this.sessionStateGraphs.set(
					sessionId,
					graphWithTranscriptSnapshot(previousGraph, nextSnapshot, revision)
				);
			}
		}
		this.entryStore.applyTranscriptDelta(sessionId, delta, new Date());
		const pendingSendIntent =
			this.getTransientProjection(sessionId).pendingSendIntent ?? null;
		if (
			nextSnapshot !== null &&
			pendingSendIntent !== null &&
			transcriptSnapshotAcknowledgesPendingSend(nextSnapshot, pendingSendIntent)
		) {
			this.transientProjectionStore.updateTransientProjection(sessionId, {
				pendingSendIntent: null,
			});
		}
	}

	private applyAssistantTextDelta(sessionId: string, delta: AssistantTextDeltaPayload): void {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		if (projection === null) {
			logger.warn("Received assistant text delta before canonical projection", {
				sessionId,
				turnId: delta.turnId,
				rowId: delta.rowId,
				revision: delta.revision,
			});
			void this.refreshSessionStateSnapshot(sessionId).match(
				() => undefined,
				() => undefined
			);
			return;
		}

		const rowKey = buildRowTokenStreamKey(delta.turnId, delta.rowId);
		const previousRow = projection.tokenStream.get(rowKey) ?? null;
		if (previousRow !== null && delta.revision < previousRow.revision) {
			return;
		}
		if (delta.revision <= projection.revision.graphRevision) {
			logger.debug("Ignoring stale assistant text delta behind canonical graph frontier", {
				sessionId,
				turnId: delta.turnId,
				rowId: delta.rowId,
				deltaRevision: delta.revision,
				graphRevision: projection.revision.graphRevision,
			});
			return;
		}

		const currentText = previousRow?.accumulatedText ?? "";
		if (delta.charOffset !== currentText.length) {
			logger.warn("Rejecting non-append assistant text delta", {
				sessionId,
				turnId: delta.turnId,
				rowId: delta.rowId,
				revision: delta.revision,
				charOffset: delta.charOffset,
				expectedOffset: currentText.length,
			});
			return;
		}

		const nextText = `${currentText}${delta.deltaText}`;
		const wordCounts = countAppendedMarkdownWords({
			previousText: currentText,
			previousWordCount: previousRow?.wordCount ?? 0,
			deltaText: delta.deltaText,
		});
		const nextRow: RowTokenStream = {
			turnId: delta.turnId,
			rowId: delta.rowId,
			accumulatedText: nextText,
			wordCount: wordCounts.wordCount,
			latestWordCount: wordCounts.latestWordCount,
			firstDeltaProducedAtMonotonicMs:
				previousRow?.firstDeltaProducedAtMonotonicMs ?? delta.producedAtMonotonicMs,
			lastDeltaProducedAtMonotonicMs: delta.producedAtMonotonicMs,
			revision: delta.revision,
		};
		const nextTokenStream = cloneRowTokenStreamMap(projection.tokenStream);
		nextTokenStream.set(rowKey, nextRow);
		getOrCreateRowTokenStreamByRowId(this.rowTokenStreamsByRowId, sessionId).set(
			delta.rowId,
			nextRow
		);
		const nextClockAnchor =
			projection.clockAnchor ??
			({
				rustMonotonicMs: delta.producedAtMonotonicMs,
				browserAnchorMs: getBrowserMonotonicMs(),
			} satisfies SessionClockAnchor);

		this.canonicalProjections.set(sessionId, {
			lifecycle: projection.lifecycle,
			activity: projection.activity,
			turnState: projection.turnState,
			activeTurnFailure: projection.activeTurnFailure,
			lastTerminalTurnId: projection.lastTerminalTurnId,
			activeStreamingTail: projection.activeStreamingTail,
			capabilities: projection.capabilities,
			tokenStream: nextTokenStream,
			clockAnchor: nextClockAnchor,
			revision: projection.revision,
		});
	}

	getGraphTranscriptRevision(sessionId: string): number | undefined {
		return this.projectionCore.getGraphTranscriptRevision(sessionId);
	}

	private getGraphRevision(sessionId: string): SessionGraphRevision | undefined {
		return this.projectionCore.getGraphRevision(sessionId);
	}

	private refreshSessionStateSnapshot(sessionId: string): InflightSessionStateRefresh {
		const existing = this.inflightSessionStateRefreshes.get(sessionId);
		if (existing) {
			return existing;
		}

		const refresh = api
			.fetchCanonicalSessionStateEnvelope(sessionId)
			.andThen((envelope) => {
				this.inflightSessionStateRefreshes.delete(sessionId);
				if (envelope.payload.kind !== "snapshot") {
					return errAsync(new SessionNotFoundError(sessionId));
				}

				this.applySessionStateEnvelope(sessionId, envelope);
				return okAsync(undefined);
			})
			.orElse((error) => {
				this.inflightSessionStateRefreshes.delete(sessionId);
				logger.error("Failed to refresh session-state snapshot", {
					sessionId,
					error,
				});
				return errAsync(error);
			});

		this.inflightSessionStateRefreshes.set(sessionId, refresh);
		return refresh;
	}

	// ============================================
	// EVENT SUBSCRIPTION
	// ============================================

	/**
	 * Initialize session update subscription.
	 */
	initializeSessionUpdates(): ResultAsync<void, AppError> {
		return this.eventService.initializeSessionUpdates(this);
	}

	/**
	 * Cleanup session update subscription.
	 */
	cleanupSessionUpdates(): void {
		this.eventService.cleanupSessionUpdates();
		this.awaitingModelRefresh.clearAllAwaitingModelRefreshTimers();
	}
}

function getOrCreateRowTokenStreamByRowId(
	rowsBySessionId: Map<string, Map<string, RowTokenStream>>,
	sessionId: string
): Map<string, RowTokenStream> {
	const existing = rowsBySessionId.get(sessionId);
	if (existing !== undefined) {
		return existing;
	}

	const created = new Map<string, RowTokenStream>();
	rowsBySessionId.set(sessionId, created);
	return created;
}

/**
 * Create and set the session store in Svelte context.
 */
export function createSessionStore(): SessionStore {
	const store = new SessionStore();
	currentSessionStore = store;
	setContext(SESSION_STORE_KEY, store);

	return store;
}

/**
 * Get the session store from Svelte context.
 */
export function getSessionStore(): SessionStore {
	const contextStore = getContext<SessionStore | undefined>(SESSION_STORE_KEY);
	if (contextStore !== undefined) {
		return contextStore;
	}
	if (currentSessionStore !== null) {
		return currentSessionStore;
	}
	const store = new SessionStore();
	currentSessionStore = store;
	return store;
}
