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
import { materializeSnapshotFromOpenFound } from "../session-state/session-state-protocol.js";
import type { AvailableCommand } from "../types/available-command.js";
import { canonicalAgentIdToString, isBuiltInCanonicalAgentId } from "../types/agent-id.js";
import type { PermissionRequest } from "../types/permission.js";
import type { ToolKind } from "../types/tool-kind.js";
import type { ActiveTurnFailure, TurnErrorUpdate } from "../types/turn-error.js";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import { aggregateFileEditsFromToolCalls } from "../logic/aggregate-file-edits.js";
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
import {
	deriveLiveSessionLifecyclePresentation,
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
import "../errors/app-error.js";
import type { GitStackedPrStep, PrChecks, PrDetails } from "../../utils/tauri-client/git.js";
import { tauriClient } from "../../utils/tauri-client.js";
import { buildPartialSessionLinkedPr } from "../application/dto/session-linked-pr.js";
import { sessionColdFromSlices } from "../application/dto/session-cold.js";
import {
	deriveSessionListStateFromCanonical,
	type SessionListState,
} from "../application/dto/session-summary.js";
import { ConnectionError, SessionNotFoundError } from "../errors/app-error.js";
import type { ToolCall } from "../types/tool-call.js";
import { createLogger } from "../utils/logger.js";
import { sessionGraphToJsonExportContent } from "../utils/session-export.js";
import { sessionGraphToMarkdown } from "../utils/session-to-markdown.js";
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
import { resolveAutomaticSessionPrNumberFromShipWorkflow } from "./services/session-pr-link-attribution.js";
import { SessionRepository } from "./services/session-repository.js";
import { SessionEntryStore } from "./session-entry-store.svelte.js";
import { getTitleUpdateFromUserMessage } from "./session-title-policy.js";
import { SessionTransientProjectionStore } from "./session-transient-projection-store.svelte.js";

const logger = createLogger({ id: "session-store", name: "SessionStore" });

const SESSION_STORE_KEY = Symbol("session-store");
const PR_CHECKS_POLL_INTERVAL_MS = 10_000;
const AWAITING_MODEL_SNAPSHOT_REFRESH_MS = 5_000;
const MAX_CANONICAL_CONFIG_STRING_LENGTH = 512;

type ProjectionTurnFailure = {
	readonly turn_id?: TurnFailureSnapshot["turn_id"];
	readonly message: TurnFailureSnapshot["message"];
	readonly code?: TurnFailureSnapshot["code"];
	readonly kind: TurnFailureSnapshot["kind"];
	readonly source?: TurnFailureSnapshot["source"] | null;
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

const SESSION_STATE_GRAPH_COPY_KEYS = [
	"requestedSessionId",
	"canonicalSessionId",
	"isAlias",
	"agentId",
	"projectPath",
	"worktreePath",
	"sourcePath",
	"revision",
	"transcriptSnapshot",
	"operations",
	"interactions",
	"turnState",
	"messageCount",
	"activeStreamingTail",
	"activeTurnFailure",
	"lastTerminalTurnId",
	"lifecycle",
	"activity",
	"capabilities",
] as const satisfies readonly (keyof SessionStateGraph)[];

type SessionStateGraphCopyKey = (typeof SESSION_STATE_GRAPH_COPY_KEYS)[number];
type MissingSessionStateGraphCopyKey = Exclude<keyof SessionStateGraph, SessionStateGraphCopyKey>;

export type SessionExportContentErrorKind = "session_not_found" | "thread_content_not_loaded";

export interface SessionExportContentError {
	readonly kind: SessionExportContentErrorKind;
	readonly message: string;
}

function assertSessionStateGraphCopyKeyCoverage(
	_coverage: Record<MissingSessionStateGraphCopyKey, never>
): void {}

assertSessionStateGraphCopyKeyCoverage({});

function sessionExportContentError(
	kind: SessionExportContentErrorKind
): SessionExportContentError {
	switch (kind) {
		case "session_not_found":
			return {
				kind,
				message: "Session not found",
			};
		case "thread_content_not_loaded":
			return {
				kind,
				message: "Thread content is not loaded",
			};
	}
}

function graphWithTranscriptSnapshot(
	graph: SessionStateGraph,
	transcriptSnapshot: TranscriptSnapshot
): SessionStateGraph {
	return {
		requestedSessionId: graph.requestedSessionId,
		canonicalSessionId: graph.canonicalSessionId,
		isAlias: graph.isAlias,
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		worktreePath: graph.worktreePath ?? null,
		sourcePath: graph.sourcePath ?? null,
		revision: {
			graphRevision: graph.revision.graphRevision,
			transcriptRevision: transcriptSnapshot.revision,
			lastEventSeq: graph.revision.lastEventSeq,
		},
		transcriptSnapshot,
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		activeStreamingTail: graph.activeStreamingTail ?? null,
		activeTurnFailure: graph.activeTurnFailure ?? null,
		lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
		lifecycle: graph.lifecycle,
		activity: graph.activity,
		capabilities: graph.capabilities,
	};
}

function graphWithLifecycle(
	graph: SessionStateGraph,
	lifecycle: SessionGraphLifecycle,
	activity: SessionGraphActivity,
	revision: SessionGraphRevision
): SessionStateGraph {
	return {
		requestedSessionId: graph.requestedSessionId,
		canonicalSessionId: graph.canonicalSessionId,
		isAlias: graph.isAlias,
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		worktreePath: graph.worktreePath ?? null,
		sourcePath: graph.sourcePath ?? null,
		revision,
		transcriptSnapshot: graph.transcriptSnapshot,
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		activeStreamingTail: graph.activeStreamingTail ?? null,
		activeTurnFailure: graph.activeTurnFailure ?? null,
		lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
		lifecycle,
		activity,
		capabilities: graph.capabilities,
	};
}

function graphWithCapabilities(
	graph: SessionStateGraph,
	capabilities: SessionGraphCapabilities,
	revision: SessionGraphRevision
): SessionStateGraph {
	return {
		requestedSessionId: graph.requestedSessionId,
		canonicalSessionId: graph.canonicalSessionId,
		isAlias: graph.isAlias,
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		worktreePath: graph.worktreePath ?? null,
		sourcePath: graph.sourcePath ?? null,
		revision,
		transcriptSnapshot: graph.transcriptSnapshot,
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		activeStreamingTail: graph.activeStreamingTail ?? null,
		activeTurnFailure: graph.activeTurnFailure ?? null,
		lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
		lifecycle: graph.lifecycle,
		activity: graph.activity,
		capabilities,
	};
}

function mergeOperationSnapshots(
	current: readonly OperationSnapshot[],
	patches: readonly OperationSnapshot[]
): OperationSnapshot[] {
	const operationById = new Map<string, OperationSnapshot>();
	const orderedIds: string[] = [];

	for (const operation of current) {
		operationById.set(operation.id, operation);
		orderedIds.push(operation.id);
	}

	for (const patch of patches) {
		const existing = operationById.get(patch.id);
		if (existing === undefined) {
			orderedIds.push(patch.id);
		}
		operationById.set(patch.id, patch);
	}

	const operations: OperationSnapshot[] = [];
	for (const operationId of orderedIds) {
		const operation = operationById.get(operationId);
		if (operation !== undefined) {
			operations.push(operation);
		}
	}
	return operations;
}

function mergeInteractionSnapshots(
	current: readonly InteractionSnapshot[],
	patches: readonly InteractionSnapshot[]
): InteractionSnapshot[] {
	const interactionById = new Map<string, InteractionSnapshot>();
	const orderedIds: string[] = [];

	for (const interaction of current) {
		interactionById.set(interaction.id, interaction);
		orderedIds.push(interaction.id);
	}

	for (const patch of patches) {
		if (!interactionById.has(patch.id)) {
			orderedIds.push(patch.id);
		}
		interactionById.set(patch.id, patch);
	}

	const interactions: InteractionSnapshot[] = [];
	for (const interactionId of orderedIds) {
		const interaction = interactionById.get(interactionId);
		if (interaction !== undefined) {
			interactions.push(interaction);
		}
	}
	return interactions;
}

function graphWithPatches(input: {
	readonly graph: SessionStateGraph;
	readonly revision: SessionGraphRevision;
	readonly activity: SessionGraphActivity;
	readonly turnState: SessionTurnState;
	readonly activeTurnFailure: TurnFailureSnapshot | null;
	readonly lastTerminalTurnId: string | null;
	readonly activeStreamingTail: SessionStateGraph["activeStreamingTail"] | undefined;
	readonly operationPatches: readonly OperationSnapshot[];
	readonly interactionPatches: readonly InteractionSnapshot[];
}): SessionStateGraph {
	return {
		requestedSessionId: input.graph.requestedSessionId,
		canonicalSessionId: input.graph.canonicalSessionId,
		isAlias: input.graph.isAlias,
		agentId: input.graph.agentId,
		projectPath: input.graph.projectPath,
		worktreePath: input.graph.worktreePath ?? null,
		sourcePath: input.graph.sourcePath ?? null,
		revision: input.revision,
		transcriptSnapshot: input.graph.transcriptSnapshot,
		operations:
			input.operationPatches.length === 0
				? input.graph.operations
				: mergeOperationSnapshots(input.graph.operations, input.operationPatches),
		interactions:
			input.interactionPatches.length === 0
				? input.graph.interactions
				: mergeInteractionSnapshots(input.graph.interactions, input.interactionPatches),
		turnState: input.turnState,
		messageCount: input.graph.messageCount,
		activeStreamingTail:
			input.activeStreamingTail === undefined
				? (input.graph.activeStreamingTail ?? null)
				: input.activeStreamingTail,
		activeTurnFailure: input.activeTurnFailure,
		lastTerminalTurnId: input.lastTerminalTurnId,
		lifecycle: input.graph.lifecycle,
		activity: input.activity,
		capabilities: input.graph.capabilities,
	};
}

function replaceTranscriptEntry(
	entries: readonly TranscriptEntry[],
	nextEntry: TranscriptEntry
): TranscriptEntry[] {
	const nextEntries: TranscriptEntry[] = [];
	let replaced = false;
	for (const entry of entries) {
		if (entry.entryId === nextEntry.entryId) {
			nextEntries.push(nextEntry);
			replaced = true;
		} else {
			nextEntries.push(entry);
		}
	}
	if (!replaced) {
		nextEntries.push(nextEntry);
	}
	return nextEntries;
}

function appendTranscriptSegment(
	entries: readonly TranscriptEntry[],
	entryId: string,
	role: TranscriptEntry["role"],
	segment: TranscriptEntry["segments"][number]
): TranscriptEntry[] {
	const nextEntries: TranscriptEntry[] = [];
	let appended = false;
	for (const entry of entries) {
		if (entry.entryId === entryId && entry.role === role) {
			nextEntries.push({
				entryId: entry.entryId,
				role: entry.role,
				segments: entry.segments.concat([segment]),
			});
			appended = true;
		} else {
			nextEntries.push(entry);
		}
	}
	if (!appended) {
		nextEntries.push({
			entryId,
			role,
			segments: [segment],
		});
	}
	return nextEntries;
}

function applyTranscriptDeltaToSnapshot(
	snapshot: TranscriptSnapshot,
	delta: TranscriptDelta
): TranscriptSnapshot {
	let entries = snapshot.entries;

	for (const operation of delta.operations) {
		if (operation.kind === "replaceSnapshot") {
			entries = operation.snapshot.entries;
			continue;
		}

		if (operation.kind === "appendEntry") {
			entries = replaceTranscriptEntry(entries, operation.entry);
			continue;
		}

		entries = appendTranscriptSegment(
			entries,
			operation.entryId,
			operation.role,
			operation.segment
		);
	}

	return {
		revision: delta.snapshotRevision,
		entries,
	};
}

function buildRowTokenStreamKey(turnId: string, rowId: string): string {
	return `${turnId}:${rowId}`;
}

function cloneRowTokenStreamMap(
	tokenStream: ReadonlyMap<string, RowTokenStream>
): Map<string, RowTokenStream> {
	const nextTokenStream = new Map<string, RowTokenStream>();
	for (const [key, value] of tokenStream) {
		nextTokenStream.set(key, value);
	}
	return nextTokenStream;
}

function emptyRowTokenStream(): ReadonlyMap<string, RowTokenStream> {
	return new Map<string, RowTokenStream>();
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

const PR_STATE_CACHE_TTL_MS = 60_000;
const PR_CHECKS_CACHE_TTL_MS = 10_000;

interface CachedPrDetails {
	details: PrDetails;
	fetchedAt: number;
}

interface CachedPrChecks {
	checks: PrChecks;
	fetchedAt: number;
}

interface SessionPrLinkRef {
	readonly sessionId: string;
	readonly projectPath: string;
	readonly prNumber: number;
	readonly prState: SessionMetadata["prState"];
	readonly linkedPr: SessionMetadata["linkedPr"];
}

function sessionColdWithMutableUpdates(
	session: SessionCold,
	updates: SessionMutableColdUpdates,
	updatedAt: Date
): SessionCold {
	return sessionColdFromSlices(
		{
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			worktreePath: "worktreePath" in updates ? updates.worktreePath : session.worktreePath,
		},
		{
			title: updates.title !== undefined ? updates.title : session.title,
			createdAt: updates.createdAt !== undefined ? updates.createdAt : session.createdAt,
			updatedAt,
			sourcePath: "sourcePath" in updates ? updates.sourcePath : session.sourcePath,
			sessionLifecycleState:
				"sessionLifecycleState" in updates
					? updates.sessionLifecycleState
					: session.sessionLifecycleState,
			parentId: updates.parentId !== undefined ? updates.parentId : session.parentId,
			prNumber: "prNumber" in updates ? updates.prNumber : session.prNumber,
			prState: "prState" in updates ? updates.prState : session.prState,
			prLinkMode: "prLinkMode" in updates ? updates.prLinkMode : session.prLinkMode,
			linkedPr: "linkedPr" in updates ? updates.linkedPr : session.linkedPr,
			worktreeDeleted:
				"worktreeDeleted" in updates ? updates.worktreeDeleted : session.worktreeDeleted,
			sequenceId: "sequenceId" in updates ? updates.sequenceId : session.sequenceId,
		}
	);
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
			sequenceId: input.preservedMetadata?.sequenceId,
		}
	);
}

function buildResolvedSessionLinkedPr(details: PrDetails): SessionLinkedPr {
	return {
		prNumber: details.number,
		state: details.state,
		url: details.url,
		title: details.title,
		additions: details.additions,
		deletions: details.deletions,
		isDraft: details.isDraft,
		isLoading: false,
		hasResolvedDetails: true,
		checksHeadSha: null,
		checks: [],
		isChecksLoading: true,
		hasResolvedChecks: false,
	};
}

function buildResolvedSessionPrChecks(
	checks: PrChecks
): Pick<SessionLinkedPr, "checksHeadSha" | "checks" | "isChecksLoading" | "hasResolvedChecks"> {
	return {
		checksHeadSha: checks.headSha,
		checks: checks.checkRuns.map((checkRun) => ({
			name: checkRun.name,
			status: checkRun.status,
			conclusion: checkRun.conclusion,
			detailsUrl: checkRun.detailsUrl,
			startedAt: checkRun.startedAt,
			completedAt: checkRun.completedAt,
			workflowName: checkRun.workflowName,
		})),
		isChecksLoading: false,
		hasResolvedChecks: true,
	};
}

function hasActivePrChecks(checks: SessionLinkedPr["checks"]): boolean {
	return checks.some((checkRun) => checkRun.status !== "COMPLETED");
}

function mapGraphAvailableModels(capabilities: SessionGraphCapabilities): Array<Model> | null {
	if (!capabilities.models) {
		return null;
	}

	const availableModels = capabilities.models.availableModels ?? [];
	return availableModels.map((model) => ({
		id: model.modelId,
		name: model.name,
		description: model.description ?? undefined,
	}));
}

function mapGraphAvailableModes(capabilities: SessionGraphCapabilities): Array<Mode> | null {
	if (!capabilities.modes) {
		return null;
	}

	const availableModes = capabilities.modes.availableModes ?? [];
	return availableModes.map((mode) => ({
		id: mode.id,
		name: mode.name,
		description: mode.description ?? undefined,
	}));
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

function isJsonObjectValue(value: JsonValue): boolean {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedConfigIdentityText(option: CanonicalConfigOptionData): string {
	return `${option.id} ${option.name} ${option.category}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function configIdentityContainsCredentialLabel(option: CanonicalConfigOptionData): boolean {
	const identityText = `${option.id} ${option.name} ${option.category}`.toLowerCase();
	const normalizedIdentityText = normalizedConfigIdentityText(option);
	return [
		"api_key",
		"apikey",
		"access_key",
		"accesskey",
		"access_token",
		"refresh_token",
		"auth_token",
		"bearer",
		"credential",
		"oauth",
		"password",
		"private_key",
		"privatekey",
		"secret",
	].some((needle) => identityText.includes(needle) || normalizedIdentityText.includes(needle));
}

function looksLikeCredentialValue(value: string): boolean {
	const lowerValue = value.toLowerCase();
	return (
		lowerValue.startsWith("bearer ") ||
		lowerValue.startsWith("basic ") ||
		lowerValue.startsWith("sk-") ||
		lowerValue.startsWith("ghp_") ||
		lowerValue.startsWith("gho_") ||
		lowerValue.startsWith("github_pat_") ||
		lowerValue.startsWith("xoxb-") ||
		(value.startsWith("eyJ") && value.split(".").length === 3)
	);
}

function sanitizeCanonicalConfigValue(
	value: JsonValue,
	option: CanonicalConfigOptionData,
	field: "currentValue" | "option.value"
): JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number") {
		return value;
	}

	if (typeof value === "string") {
		const trimmedValue = value.trim();
		const shouldRedact =
			trimmedValue.length > MAX_CANONICAL_CONFIG_STRING_LENGTH ||
			trimmedValue.includes("\n") ||
			trimmedValue.includes("\r") ||
			configIdentityContainsCredentialLabel(option) ||
			looksLikeCredentialValue(trimmedValue);
		if (shouldRedact) {
			logger.warn("Redacting unsafe canonical config option value", {
				configId: option.id,
				configName: option.name,
				configCategory: option.category,
				field,
			});
			return null;
		}
		return value;
	}

	if (Array.isArray(value) || isJsonObjectValue(value)) {
		logger.warn("Redacting structured canonical config option value", {
			configId: option.id,
			configName: option.name,
			configCategory: option.category,
			field,
		});
		return null;
	}

	return null;
}

function sanitizeCanonicalConfigOptions(
	options: ReadonlyArray<CanonicalConfigOptionData>
): Array<CanonicalConfigOptionData> {
	return options.map((option) => {
		const sanitizedOptions = (option.options ?? []).map(
			(candidate: CanonicalConfigOptionValue) => ({
				name: candidate.name,
				value: sanitizeCanonicalConfigValue(candidate.value, option, "option.value"),
			})
		);
		const optionsWithDescriptions = sanitizedOptions.map((candidate, index) => {
			const originalDescription = option.options?.[index]?.description;
			if (originalDescription === undefined) {
				return candidate;
			}
			return {
				name: candidate.name,
				value: candidate.value,
				description: originalDescription,
			};
		});
		const sanitizedOptionBase = {
			id: option.id,
			name: option.name,
			category: option.category,
			type: option.type,
			options: optionsWithDescriptions,
		};
		const sanitizedOptionWithDescription =
			option.description === undefined
				? sanitizedOptionBase
				: {
						id: sanitizedOptionBase.id,
						name: sanitizedOptionBase.name,
						category: sanitizedOptionBase.category,
						type: sanitizedOptionBase.type,
						description: option.description,
						options: sanitizedOptionBase.options,
					};
		if (option.currentValue === undefined) {
			return sanitizedOptionWithDescription;
		}
		const sanitizedCurrentValue = sanitizeCanonicalConfigValue(
			option.currentValue,
			option,
			"currentValue"
		);
		if (option.description === undefined) {
			return {
				id: sanitizedOptionBase.id,
				name: sanitizedOptionBase.name,
				category: sanitizedOptionBase.category,
				type: sanitizedOptionBase.type,
				currentValue: sanitizedCurrentValue,
				options: sanitizedOptionBase.options,
			};
		}
		return {
			id: sanitizedOptionWithDescription.id,
			name: sanitizedOptionWithDescription.name,
			category: sanitizedOptionWithDescription.category,
			type: sanitizedOptionWithDescription.type,
			description: option.description,
			currentValue: sanitizedCurrentValue,
			options: sanitizedOptionWithDescription.options,
		};
	});
}

function sanitizeCanonicalCapabilities(
	capabilities: SessionGraphCapabilities
): SessionGraphCapabilities {
	return {
		models: capabilities.models ?? null,
		modes: capabilities.modes ?? null,
		availableCommands: capabilities.availableCommands,
		configOptions:
			capabilities.configOptions === undefined || capabilities.configOptions === null
				? capabilities.configOptions
				: sanitizeCanonicalConfigOptions(capabilities.configOptions),
		autonomousEnabled: capabilities.autonomousEnabled,
	};
}

function projectGraphCapabilities(capabilities: SessionGraphCapabilities): {
	availableModels: Array<Model> | null;
	availableModes: Array<Mode> | null;
	availableCommands: AvailableCommand[] | null;
	currentModelId: string | null;
	currentModeId: string | null;
	currentModel: Model | null;
	currentMode: Mode | null;
	modelsDisplay: ModelsForDisplay | undefined;
	providerMetadata: ProviderMetadataProjection | undefined;
	configOptions: ReadonlyArray<CanonicalConfigOptionData> | null;
	autonomousEnabled: boolean | null;
} {
	const availableModels = mapGraphAvailableModels(capabilities);
	const availableModes = mapGraphAvailableModes(capabilities);
	const modelState = capabilities.models as
		| (NonNullable<SessionGraphCapabilities["models"]> & {
				readonly providerMetadata?: ProviderMetadataProjection | null;
		  })
		| null
		| undefined;
	const providerMetadata = modelState?.providerMetadata ?? undefined;
	const modelsDisplay = capabilities.models?.modelsDisplay ?? undefined;
	const currentModeId = capabilities.modes?.currentModeId ?? null;
	const currentMode =
		currentModeId === null
			? null
			: (availableModes?.find((mode) => mode.id === currentModeId) ?? null);
	const currentModelId = capabilities.models?.currentModelId ?? null;
	const currentModel =
		currentModelId === null
			? null
			: (availableModels?.find((model) => model.id === currentModelId) ?? null);

	return {
		availableModels,
		availableModes,
		availableCommands: capabilities.availableCommands ?? null,
		currentModelId,
		currentModeId,
		currentModel,
		currentMode,
		modelsDisplay,
		providerMetadata,
		configOptions: capabilities.configOptions ?? null,
		autonomousEnabled: capabilities.autonomousEnabled ?? null,
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

function deriveCapabilityPreviewState(
	capabilities: SessionGraphCapabilities
): SessionCapabilities["previewState"] {
	return capabilities.models && capabilities.modes ? "canonical" : "partial";
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

type ProjectedGraphCapabilities = ReturnType<typeof projectGraphCapabilities>;

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
	sessions = $state<SessionCold[]>([]);
	loading = $state(false);

	/** Project paths currently being scanned for sessions (for per-project skeleton display). */
	readonly scanningProjectPaths = new SvelteSet<string>();

	// Callbacks invoked when a session is removed (e.g., plan store cleanup)
	private readonly onRemoveCallbacks: Array<(sessionId: string) => void> = [];

	// Transient projection store for local-only UI state.
	private readonly transientProjectionStore = new SessionTransientProjectionStore();

	// Canonical graph selector state for lifecycle/activity/actionability consumers.
	private readonly canonicalProjections = new SvelteMap<string, CanonicalSessionProjection>();
	private readonly sessionStateGraphs = new SvelteMap<string, SessionStateGraph>();
	private readonly canonicalCapabilitiesMaterialized = new SvelteMap<string, boolean>();
	private readonly pendingCreationSessions = new SvelteMap<string, CreatedPendingSessionResult>();

	// Canonical tool execution domain state
	private readonly operationStore = new OperationStore();

	// Entry store (entries + chunk aggregation)
	private readonly entryStore = new SessionEntryStore(this.operationStore);
	private sessionOpenHydrator: CreatedSessionHydrator | null = null;
	private liveSessionStateGraphConsumer: LiveSessionStateGraphConsumer | null = null;
	private readonly inflightSessionStateRefreshes = new Map<string, InflightSessionStateRefresh>();
	private readonly awaitingModelRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

	// PR details cache/dedupe (prevents repeated gh pr view storms during scans)
	private readonly prDetailsCache = new Map<string, CachedPrDetails>();
	private readonly prDetailsInflight = new Map<string, ResultAsync<PrDetails | null, never>>();
	private readonly prChecksCache = new Map<string, CachedPrChecks>();
	private readonly prChecksInflight = new Map<string, ResultAsync<PrChecks | null, never>>();
	private readonly prChecksVisibleSurfaces = new Map<string, Set<string>>();
	private readonly prChecksPollTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly prLinkUpdateSequence = new Map<string, number>();

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

	// === DERIVED LOOKUPS ===
	readonly sessionById = $derived.by(() => {
		return new Map(this.sessions.map((s) => [s.id, s]));
	});

	readonly sessionsByProject = $derived.by(() => {
		const map = new Map<string, SessionCold[]>();
		for (const s of this.sessions) {
			let arr = map.get(s.projectPath);
			if (!arr) {
				arr = [];
				map.set(s.projectPath, arr);
			}
			arr.push(s);
		}
		return map;
	});

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
		this.sessions = sessions;
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
		for (const p of paths) {
			this.scanningProjectPaths.add(p);
		}
	}

	/**
	 * Clear scanning state for project paths.
	 */
	removeScanningProjects(paths: string[]): void {
		for (const p of paths) {
			this.scanningProjectPaths.delete(p);
		}
	}

	// ============================================
	// ISessionStateReader IMPLEMENTATION
	// ============================================

	/**
	 * Get all sessions (cold data only).
	 */
	getAllSessions(): SessionCold[] {
		return this.sessions;
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

	/**
	 * Canonical session-list status summary; uses Rust-owned lifecycle/activity only.
	 */
	getSessionListState(sessionId: string): SessionListState {
		return deriveSessionListStateFromCanonical(this.canonicalProjections.get(sessionId) ?? null);
	}

	hasSessionCanonicalProjection(sessionId: string): boolean {
		return this.canonicalProjections.has(sessionId);
	}

	/**
	 * Canonical message count; null means no canonical graph exists yet.
	 */
	getSessionMessageCount(sessionId: string): number | null {
		return this.sessionStateGraphs.get(sessionId)?.messageCount ?? null;
	}

	/**
	 * Canonical transcript entries; null means no canonical graph exists yet.
	 */
	getSessionTranscriptEntries(sessionId: string): ReadonlyArray<TranscriptEntry> | null {
		return this.sessionStateGraphs.get(sessionId)?.transcriptSnapshot.entries ?? null;
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
		const graph = this.sessionStateGraphs.get(sessionId) ?? null;
		if (graph === null) {
			return err(sessionExportContentError("thread_content_not_loaded"));
		}

		return ok(sessionGraphToMarkdown(graph));
	}

	getSessionJsonExportContent(sessionId: string): Result<string, SessionExportContentError> {
		const sessionIdentity = this.getSessionIdentity(sessionId);
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionIdentity || !sessionMetadata) {
			return err(sessionExportContentError("session_not_found"));
		}

		const graph = this.sessionStateGraphs.get(sessionId) ?? null;
		if (graph === null) {
			return err(sessionExportContentError("thread_content_not_loaded"));
		}

		return ok(
			sessionGraphToJsonExportContent(
				sessionColdFromSlices(sessionIdentity, sessionMetadata),
				graph
			)
		);
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
		return this.canonicalProjections.get(sessionId)?.lifecycle.actionability.canSend ?? null;
	}

	getSessionLifecycleStatus(sessionId: string): SessionGraphLifecycle["status"] | null {
		return this.canonicalProjections.get(sessionId)?.lifecycle.status ?? null;
	}

	getSessionLifecycle(sessionId: string): SessionGraphLifecycle | null {
		return this.sessionStateGraphs.get(sessionId)?.lifecycle ?? null;
	}

	getSessionActivity(sessionId: string): SessionGraphActivity | null {
		return this.sessionStateGraphs.get(sessionId)?.activity ?? null;
	}

	getSessionGraphRevision(sessionId: string): SessionGraphRevision | null {
		return this.sessionStateGraphs.get(sessionId)?.revision ?? null;
	}

	/**
	 * Canonical turn state; null means no canonical graph exists yet.
	 */
	getSessionTurnState(sessionId: string): SessionTurnState | null {
		return this.sessionStateGraphs.get(sessionId)?.turnState ?? null;
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

	getSessionLiveWorkSource(sessionId: string | null, active: boolean): LiveSessionWorkSource {
		const projection = sessionId === null ? null : (this.canonicalProjections.get(sessionId) ?? null);
		if (active) {
			return liveSessionWorkSourceFromCanonicalProjection(sessionId, projection);
		}
		return inactiveSessionWorkSourceFromCanonicalProjection(sessionId, projection);
	}

	getSessionPendingSendIntent(sessionId: string): SessionPendingSendIntent | null {
		return this.transientProjectionStore.getTransientProjection(sessionId).pendingSendIntent ?? null;
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
		return this.transientProjectionStore.getTransientProjection(sessionId).autonomousTransition !== "idle";
	}

	getSessionStatusChangedAt(sessionId: string): number {
		return this.transientProjectionStore.getTransientProjection(sessionId).statusChangedAt;
	}

	private getCanonicalProjectedCapabilities(sessionId: string): ProjectedGraphCapabilities | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		const sessionIdentity = this.getSessionIdentity(sessionId);
		if (
			projection === null ||
			sessionIdentity === undefined ||
			this.canonicalCapabilitiesMaterialized.get(sessionId) !== true
		) {
			return null;
		}
		return projectGraphCapabilities(projection.capabilities);
	}

	hasSessionCanonicalCapabilities(sessionId: string): boolean {
		return this.getCanonicalProjectedCapabilities(sessionId) !== null;
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
		return this.sessionStateGraphs.get(sessionId)?.lastTerminalTurnId ?? null;
	}

	getRowTokenStream(sessionId: string, turnId: string, rowId: string): RowTokenStream | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		if (projection === null) {
			return null;
		}
		return projection.tokenStream.get(buildRowTokenStreamKey(turnId, rowId)) ?? null;
	}

	getRowTokenStreamByRowId(sessionId: string, rowId: string): RowTokenStream | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		if (projection === null) {
			return null;
		}
		for (const rowTokenStream of projection.tokenStream.values()) {
			if (rowTokenStream.rowId === rowId) {
				return rowTokenStream;
			}
		}
		return null;
	}

	getActiveStreamingTailRowId(sessionId: string): string | null {
		return this.canonicalProjections.get(sessionId)?.activeStreamingTail?.rowId ?? null;
	}

	getClockAnchor(sessionId: string): SessionClockAnchor | null {
		return this.canonicalProjections.get(sessionId)?.clockAnchor ?? null;
	}

	/**
	 * Canonical autonomous setting; null means no canonical projection.
	 */
	getSessionAutonomousEnabled(sessionId: string): boolean | null {
		return this.canonicalProjections.get(sessionId)?.capabilities.autonomousEnabled ?? null;
	}

	/**
	 * Canonical current mode id; null means no canonical capabilities or no selected mode.
	 */
	getSessionCurrentModeId(sessionId: string): string | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.currentModeId ?? null;
	}

	/**
	 * Canonical current model id; null means no canonical capabilities or no selected model.
	 */
	getSessionCurrentModelId(sessionId: string): string | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.currentModelId ?? null;
	}

	/**
	 * Canonical available commands; null means no canonical capabilities projection.
	 */
	getSessionAvailableCommands(sessionId: string): ReadonlyArray<AvailableCommand> | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.availableCommands ?? null;
	}

	/**
	 * Canonical config options; null means no canonical capabilities projection.
	 */
	getSessionConfigOptions(sessionId: string): ReadonlyArray<CanonicalConfigOptionData> | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.configOptions ?? null;
	}

	/**
	 * Canonical available models; null means no canonical capabilities projection.
	 */
	getSessionAvailableModels(sessionId: string): ReadonlyArray<Model> | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.availableModels ?? null;
	}

	/**
	 * Canonical available modes; null means no canonical capabilities projection.
	 */
	getSessionAvailableModes(sessionId: string): ReadonlyArray<Mode> | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.availableModes ?? null;
	}

	/**
	 * Canonical model display metadata; null means no canonical capabilities projection.
	 */
	getSessionModelsDisplay(sessionId: string): ModelsForDisplay | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.modelsDisplay ?? null;
	}

	/**
	 * Canonical provider metadata; null means no canonical capabilities projection.
	 */
	getSessionProviderMetadata(sessionId: string): ProviderMetadataProjection | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.providerMetadata ?? null;
	}

	/**
	 * Canonical capability revision; null means no materialized canonical capabilities.
	 */
	getSessionCapabilityRevision(sessionId: string): SessionGraphRevision | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		if (
			projection === null ||
			this.getCanonicalProjectedCapabilities(sessionId) === null
		) {
			return null;
		}
		return projection.revision;
	}

	getSessionCapabilityPendingMutationId(sessionId: string): string | null {
		if (this.getCanonicalProjectedCapabilities(sessionId) === null) {
			return null;
		}
		const mutationState = this.getTransientProjection(sessionId).capabilityMutationState ?? {
			pendingMutationId: null,
			previewState: null,
		};
		return mutationState.pendingMutationId;
	}

	getSessionCapabilityPreviewState(
		sessionId: string
	): SessionCapabilities["previewState"] | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		if (
			projection === null ||
			this.getCanonicalProjectedCapabilities(sessionId) === null
		) {
			return null;
		}
		const mutationState = this.getTransientProjection(sessionId).capabilityMutationState ?? {
			pendingMutationId: null,
			previewState: null,
		};
		return mutationState.previewState ?? deriveCapabilityPreviewState(projection.capabilities);
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

	/**
	 * Get sessions for a project (cold data only).
	 */
	getSessionsForProject(projectPath: string): SessionCold[] {
		return this.sessionsByProject.get(projectPath) || [];
	}

	/**
	 * Check if a session exists and has been preloaded from persisted provider history.
	 * Returns the cold session data if preloaded, null otherwise.
	 */
	getSessionDetail(sessionId: string): SessionCold | null {
		const sessionIdentity = this.getSessionIdentity(sessionId);
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionIdentity || !sessionMetadata) {
			return null;
		}
		if (!this.entryStore.isPreloaded(sessionId)) {
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
		const toolCalls = this.getSessionToolCalls(sessionId);
		if (toolCalls.length === 0) {
			return null;
		}
		const state = aggregateFileEditsFromToolCalls(toolCalls);
		return state.fileCount > 0 ? state : null;
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

	getSessionCurrentToolKind(sessionId: string): ToolKind | null {
		return this.operationStore.getCurrentToolKind(sessionId);
	}

	isPermissionRepresentedByToolCall(
		permission: PermissionRequest,
		sessionId: string
	): boolean {
		return isPermissionRepresentedByOperation(permission, sessionId, this.operationStore);
	}

	getVisiblePermissionsForSessionBar(
		permissions: ReadonlyArray<PermissionRequest>
	): PermissionRequest[] {
		return visiblePermissionsForOperations(permissions, this.operationStore);
	}

	/**
	 * Check if session is preloaded.
	 */
	isPreloaded(sessionId: string): boolean {
		return this.entryStore.isPreloaded(sessionId);
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
		const previousTransientProjection = this.getTransientProjection(graph.canonicalSessionId);
		const previousProjection = this.canonicalProjections.get(graph.canonicalSessionId) ?? null;
		const preservedStreamingState = preserveCanonicalStreamingState(previousProjection);
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
		this.sessions = [session, ...this.sessions];
		logger.debug("Added session", { sessionId: session.id });
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
		this.canonicalCapabilitiesMaterialized.delete(sessionId);
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
			preservedMetadata: preservedSession,
		});

		if (canonicalSession) {
			this.sessions = this.sessions.map((session) =>
				session.id === canonicalSessionId ? snapshotSession : session
			);
		} else {
			this.addSession(snapshotSession);
		}

		this.operationStore.replaceSessionOperations(canonicalSessionId, snapshot.operations);
		this.entryStore.replaceTranscriptSnapshot(canonicalSessionId, snapshot.transcriptSnapshot, now);
		this.transientProjectionStore.initializeTransientProjection(canonicalSessionId);
		const graph = materializeSnapshotFromOpenFound(snapshot).graph;
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
			sessionLifecycleState: graph.sourcePath ? "persisted" : "created",
			parentId: null,
		});
		this.pendingCreationSessions.delete(sessionId);
		if (graph.isAlias) {
			this.pendingCreationSessions.delete(graph.requestedSessionId);
		}
		return true;
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
		this.sessions = this.sessions.map((session) => {
			if (session.id !== id) {
				return session;
			}

			const updatedAt =
				updates.updatedAt !== undefined
					? updates.updatedAt
					: options?.touchUpdatedAt === false
						? session.updatedAt
						: new Date();

			return sessionColdWithMutableUpdates(session, updates, updatedAt);
		});
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
		options?: { openToken?: string }
	): ResultAsync<SessionCold, AppError> {
		return this.connectionMgr.connectSession(sessionId, this, options);
	}

	/**
	 * Disconnect a session.
	 */
	disconnectSession(sessionId: string): void {
		this.connectionMgr.disconnectSession(sessionId);
		this.messagingSvc.clearSessionState(sessionId);
		this.clearAwaitingModelRefreshTimer(sessionId);
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
		this.clearAllAwaitingModelRefreshTimers();
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
	// PR LINKING + STATE REFRESH
	// ============================================

	updateSessionPrLink(
		sessionId: string,
		projectPath: string,
		prNumber: number | null,
		prLinkMode: SessionPrLinkMode
	): ResultAsync<void, AppError> {
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionMetadata) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const nextLinkedPr =
			prNumber == null
				? undefined
				: sessionMetadata.linkedPr?.prNumber === prNumber
					? {
							prNumber: sessionMetadata.linkedPr.prNumber,
							state: sessionMetadata.linkedPr.state,
							url: sessionMetadata.linkedPr.url,
							title: sessionMetadata.linkedPr.title,
							additions: sessionMetadata.linkedPr.additions,
							deletions: sessionMetadata.linkedPr.deletions,
							isDraft: sessionMetadata.linkedPr.isDraft,
							isLoading: sessionMetadata.linkedPr.isLoading,
							hasResolvedDetails: sessionMetadata.linkedPr.hasResolvedDetails,
							checksHeadSha: sessionMetadata.linkedPr.checksHeadSha,
							checks: sessionMetadata.linkedPr.checks,
							isChecksLoading: sessionMetadata.linkedPr.isChecksLoading,
							hasResolvedChecks: sessionMetadata.linkedPr.hasResolvedChecks,
						}
					: buildPartialSessionLinkedPr(prNumber, sessionMetadata.prState);
		const nextPrState =
			prNumber == null ? undefined : nextLinkedPr ? nextLinkedPr.state : sessionMetadata.prState;

		this.updateSession(
			sessionId,
			{
				prNumber: prNumber ?? undefined,
				prState: nextPrState,
				prLinkMode,
				linkedPr: nextLinkedPr,
			},
			{ touchUpdatedAt: false }
		);

		if (prNumber != null) {
			this.setLinkedPrLoading(projectPath, prNumber, true);
			void this.refreshSessionPrState(sessionId, projectPath, prNumber);
		}

		return tauriClient.history.setSessionPrNumber(sessionId, prNumber, prLinkMode);
	}

	restoreAutomaticSessionPrLink(
		sessionId: string,
		projectPath: string
	): ResultAsync<void, AppError> {
		return this.updateSessionPrLink(sessionId, projectPath, null, "automatic");
	}

	applyAutomaticPrLinkFromShipWorkflow(
		sessionId: string,
		projectPath: string,
		pr: GitStackedPrStep
	): ResultAsync<number | null, never> {
		const nextSequence = (this.prLinkUpdateSequence.get(sessionId) ?? 0) + 1;
		this.prLinkUpdateSequence.set(sessionId, nextSequence);

		return resolveAutomaticSessionPrNumberFromShipWorkflow(projectPath, pr).andThen((prNumber) => {
			if (this.prLinkUpdateSequence.get(sessionId) !== nextSequence) {
				return okAsync<number | null, never>(null);
			}

			if (prNumber == null) {
				return okAsync<number | null, never>(null);
			}

			const sessionMetadata = this.getSessionMetadata(sessionId);
			if (!sessionMetadata || sessionMetadata.prLinkMode === "manual") {
				return okAsync<number | null, never>(null);
			}

			return this.updateSessionPrLink(sessionId, projectPath, prNumber, "automatic")
				.map(() => prNumber)
				.orElse(() => okAsync<number | null, never>(null));
		});
	}

	invalidatePrDetails(projectPath: string, prNumber: number): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		this.prDetailsCache.delete(cacheKey);
	}

	invalidatePrChecks(projectPath: string, prNumber: number): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		this.prChecksCache.delete(cacheKey);
	}

	registerVisiblePrChecksSurface(
		projectPath: string,
		prNumber: number,
		surfaceId: string
	): () => void {
		if (prNumber <= 0 || surfaceId.trim().length === 0) {
			return () => {};
		}

		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		const currentSurfaces = this.prChecksVisibleSurfaces.get(cacheKey) ?? new Set<string>();
		currentSurfaces.add(surfaceId);
		this.prChecksVisibleSurfaces.set(cacheKey, currentSurfaces);
		this.ensurePrChecksPolling(projectPath, prNumber);

		return () => {
			const nextSurfaces = this.prChecksVisibleSurfaces.get(cacheKey);
			if (!nextSurfaces) {
				return;
			}
			nextSurfaces.delete(surfaceId);
			if (nextSurfaces.size === 0) {
				this.prChecksVisibleSurfaces.delete(cacheKey);
				this.stopPrChecksPolling(cacheKey);
				return;
			}
			this.prChecksVisibleSurfaces.set(cacheKey, nextSurfaces);
		};
	}

	refreshSessionPrChecks(
		sessionId: string,
		projectPath: string,
		prNumber: number,
		options?: { force?: boolean }
	): ResultAsync<PrChecks | null, never> {
		if (prNumber <= 0) {
			return okAsync<PrChecks | null, never>(null);
		}

		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		const cachedChecks = options?.force ? null : this.getFreshCachedPrChecks(cacheKey);
		if (cachedChecks) {
			this.applyPrChecksToSessions(projectPath, prNumber, cachedChecks);
			this.updatePrChecksPollingState(projectPath, prNumber, cachedChecks);
			return okAsync<PrChecks | null, never>(cachedChecks);
		}

		this.setLinkedPrChecksLoading(projectPath, prNumber, true);

		const inflightRequest = this.prChecksInflight.get(cacheKey);
		if (inflightRequest) {
			return inflightRequest;
		}

		const request = tauriClient.git
			.prChecks(projectPath, prNumber)
			.map((checks): PrChecks | null => {
				this.prChecksCache.set(cacheKey, {
					checks,
					fetchedAt: Date.now(),
				});
				this.prChecksInflight.delete(cacheKey);
				this.applyPrChecksToSessions(projectPath, prNumber, checks);
				this.updatePrChecksPollingState(projectPath, prNumber, checks);
				return checks;
			})
			.orElse((err) => {
				this.prChecksInflight.delete(cacheKey);
				logger.warn("Failed to fetch PR checks", {
					sessionId,
					prNumber,
					error: err.message,
				});
				this.setLinkedPrChecksLoading(projectPath, prNumber, false);
				this.updatePrChecksPollingState(projectPath, prNumber, null);
				return okAsync<PrChecks | null, never>(null);
			});

		this.prChecksInflight.set(cacheKey, request);
		return request;
	}

	/**
	 * Fetch the current PR state from GitHub for a single session and update the store.
	 * Returns the full PrDetails if fetch succeeds, null otherwise.
	 */
	refreshSessionPrState(
		sessionId: string,
		projectPath: string,
		prNumber: number
	): ResultAsync<PrDetails | null, never> {
		if (prNumber <= 0) {
			return okAsync<PrDetails | null, never>(null);
		}

		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		const cachedDetails = this.getFreshCachedPrDetails(cacheKey);
		if (cachedDetails) {
			this.applyPrDetailsToSessions(projectPath, prNumber, cachedDetails);
			return okAsync<PrDetails | null, never>(cachedDetails);
		}

		this.setLinkedPrLoading(projectPath, prNumber, true);

		const inflightRequest = this.prDetailsInflight.get(cacheKey);
		if (inflightRequest) {
			return inflightRequest;
		}

		logger.debug("refreshSessionPrState: calling prDetails", { sessionId, projectPath, prNumber });
		const request = tauriClient.git
			.prDetails(projectPath, prNumber)
			.map((details): PrDetails | null => {
				this.prDetailsCache.set(cacheKey, {
					details,
					fetchedAt: Date.now(),
				});
				this.prDetailsInflight.delete(cacheKey);
				logger.info("refreshSessionPrState: got details", {
					sessionId,
					detailsState: details.state,
				});
				this.applyPrDetailsToSessions(projectPath, prNumber, details);
				return details;
			})
			.orElse((err) => {
				this.prDetailsInflight.delete(cacheKey);
				logger.warn("Failed to fetch PR details", {
					sessionId,
					prNumber,
					error: err.message,
				});
				this.setLinkedPrLoading(projectPath, prNumber, false);
				return okAsync<PrDetails | null, never>(null);
			});

		this.prDetailsInflight.set(cacheKey, request);
		return request;
	}

	/**
	 * Refresh PR state from GitHub for all sessions that have a prNumber.
	 * Fire-and-forget — errors are logged but not propagated.
	 */
	refreshAllPrStates(): void {
		for (const session of this.sessions) {
			const sessionIdentity = this.getSessionIdentity(session.id);
			const sessionMetadata = this.getSessionMetadata(session.id);
			if (!sessionIdentity || !sessionMetadata) {
				continue;
			}
			const prNumber = sessionMetadata.prNumber;
			if (prNumber == null) {
				continue;
			}
			void this.refreshSessionPrState(sessionIdentity.id, sessionIdentity.projectPath, prNumber);
		}
	}

	private ensurePrChecksPolling(projectPath: string, prNumber: number): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		if ((this.prChecksVisibleSurfaces.get(cacheKey)?.size ?? 0) === 0) {
			return;
		}
		if (this.prChecksPollTimers.has(cacheKey)) {
			return;
		}
		void this.refreshSessionPrChecks(cacheKey, projectPath, prNumber, { force: true });
	}

	private schedulePrChecksPoll(projectPath: string, prNumber: number): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		this.stopPrChecksPolling(cacheKey);
		if ((this.prChecksVisibleSurfaces.get(cacheKey)?.size ?? 0) === 0) {
			return;
		}
		const timerId = setTimeout(() => {
			this.prChecksPollTimers.delete(cacheKey);
			void this.refreshSessionPrChecks(cacheKey, projectPath, prNumber, { force: true });
		}, PR_CHECKS_POLL_INTERVAL_MS);
		this.prChecksPollTimers.set(cacheKey, timerId);
	}

	private stopPrChecksPolling(cacheKey: string): void {
		const timerId = this.prChecksPollTimers.get(cacheKey);
		if (timerId != null) {
			clearTimeout(timerId);
			this.prChecksPollTimers.delete(cacheKey);
		}
	}

	private updatePrChecksPollingState(
		projectPath: string,
		prNumber: number,
		checks: PrChecks | null
	): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		if ((this.prChecksVisibleSurfaces.get(cacheKey)?.size ?? 0) === 0) {
			this.stopPrChecksPolling(cacheKey);
			return;
		}

		const shouldContinuePolling =
			checks === null ||
			checks.checkRuns.length === 0 ||
			hasActivePrChecks(
				checks.checkRuns.map((checkRun) => ({
					name: checkRun.name,
					status: checkRun.status,
					conclusion: checkRun.conclusion,
					detailsUrl: checkRun.detailsUrl,
					startedAt: checkRun.startedAt,
					completedAt: checkRun.completedAt,
					workflowName: checkRun.workflowName,
				}))
			);

		if (shouldContinuePolling) {
			this.schedulePrChecksPoll(projectPath, prNumber);
			return;
		}

		this.stopPrChecksPolling(cacheKey);
	}

	private getPrDetailsCacheKey(projectPath: string, prNumber: number): string {
		return `${projectPath}::${prNumber}`;
	}

	private getFreshCachedPrDetails(cacheKey: string): PrDetails | null {
		const cachedEntry = this.prDetailsCache.get(cacheKey);
		if (!cachedEntry) {
			return null;
		}

		if (Date.now() - cachedEntry.fetchedAt > PR_STATE_CACHE_TTL_MS) {
			this.prDetailsCache.delete(cacheKey);
			return null;
		}

		return cachedEntry.details;
	}

	private getFreshCachedPrChecks(cacheKey: string): PrChecks | null {
		const cachedEntry = this.prChecksCache.get(cacheKey);
		if (!cachedEntry) {
			return null;
		}

		if (Date.now() - cachedEntry.fetchedAt > PR_CHECKS_CACHE_TTL_MS) {
			this.prChecksCache.delete(cacheKey);
			return null;
		}

		return cachedEntry.checks;
	}

	private getSessionPrLinkRefs(projectPath: string, prNumber: number): SessionPrLinkRef[] {
		const refs: SessionPrLinkRef[] = [];
		for (const session of this.sessions) {
			const sessionIdentity = this.getSessionIdentity(session.id);
			const sessionMetadata = this.getSessionMetadata(session.id);
			if (!sessionIdentity || !sessionMetadata) {
				continue;
			}
			if (sessionIdentity.projectPath !== projectPath || sessionMetadata.prNumber !== prNumber) {
				continue;
			}
			refs.push({
				sessionId: sessionIdentity.id,
				projectPath: sessionIdentity.projectPath,
				prNumber: sessionMetadata.prNumber,
				prState: sessionMetadata.prState,
				linkedPr: sessionMetadata.linkedPr,
			});
		}
		return refs;
	}

	private applyPrDetailsToSessions(
		projectPath: string,
		prNumber: number,
		details: PrDetails
	): void {
		const matchingSessions = this.getSessionPrLinkRefs(projectPath, prNumber);

		if (matchingSessions.length === 0) {
			logger.warn("refreshSessionPrState: session not found", { projectPath, prNumber });
			return;
		}

		for (const session of matchingSessions) {
			const resolvedLinkedPr = buildResolvedSessionLinkedPr(details);
			const nextLinkedPr = {
				prNumber: resolvedLinkedPr.prNumber,
				state: resolvedLinkedPr.state,
				url: resolvedLinkedPr.url,
				title: resolvedLinkedPr.title,
				additions: resolvedLinkedPr.additions,
				deletions: resolvedLinkedPr.deletions,
				isDraft: resolvedLinkedPr.isDraft,
				isLoading: resolvedLinkedPr.isLoading,
				hasResolvedDetails: resolvedLinkedPr.hasResolvedDetails,
				checksHeadSha: session.linkedPr?.checksHeadSha ?? resolvedLinkedPr.checksHeadSha,
				checks: session.linkedPr?.checks ?? resolvedLinkedPr.checks,
				isChecksLoading: session.linkedPr?.isChecksLoading ?? resolvedLinkedPr.isChecksLoading,
				hasResolvedChecks:
					session.linkedPr?.hasResolvedChecks ?? resolvedLinkedPr.hasResolvedChecks,
			};
			const linkedPrChanged =
				session.linkedPr?.state !== nextLinkedPr.state ||
				session.linkedPr?.url !== nextLinkedPr.url ||
				session.linkedPr?.title !== nextLinkedPr.title ||
				session.linkedPr?.additions !== nextLinkedPr.additions ||
				session.linkedPr?.deletions !== nextLinkedPr.deletions ||
				session.linkedPr?.isDraft !== nextLinkedPr.isDraft ||
				session.linkedPr?.isLoading !== nextLinkedPr.isLoading ||
				session.linkedPr?.hasResolvedDetails !== nextLinkedPr.hasResolvedDetails ||
				session.linkedPr?.checksHeadSha !== nextLinkedPr.checksHeadSha ||
				session.linkedPr?.isChecksLoading !== nextLinkedPr.isChecksLoading ||
				session.linkedPr?.hasResolvedChecks !== nextLinkedPr.hasResolvedChecks ||
				JSON.stringify(session.linkedPr?.checks ?? []) !== JSON.stringify(nextLinkedPr.checks);

			if (details.state !== session.prState || linkedPrChanged) {
				logger.info("refreshSessionPrState: updating session linked PR", {
					sessionId: session.sessionId,
					oldState: session.prState,
					newState: details.state,
				});
				this.updateSession(
					session.sessionId,
					{
						prState: details.state,
						linkedPr: nextLinkedPr,
					},
					{ touchUpdatedAt: false }
				);
			}
		}
	}

	private applyPrChecksToSessions(projectPath: string, prNumber: number, checks: PrChecks): void {
		const matchingSessions = this.getSessionPrLinkRefs(projectPath, prNumber);

		for (const session of matchingSessions) {
			const nextChecks = buildResolvedSessionPrChecks(checks);
			const linkedPr = session.linkedPr ?? buildPartialSessionLinkedPr(prNumber, session.prState);
			const checksChanged =
				session.linkedPr?.checksHeadSha !== nextChecks.checksHeadSha ||
				session.linkedPr?.isChecksLoading !== nextChecks.isChecksLoading ||
				session.linkedPr?.hasResolvedChecks !== nextChecks.hasResolvedChecks ||
				JSON.stringify(session.linkedPr?.checks ?? []) !== JSON.stringify(nextChecks.checks);

			if (!checksChanged) {
				continue;
			}

			this.updateSession(
				session.sessionId,
				{
					linkedPr: {
						prNumber: linkedPr.prNumber,
						state: linkedPr.state,
						url: linkedPr.url,
						title: linkedPr.title,
						additions: linkedPr.additions,
						deletions: linkedPr.deletions,
						isDraft: linkedPr.isDraft,
						isLoading: linkedPr.isLoading,
						hasResolvedDetails: linkedPr.hasResolvedDetails,
						checksHeadSha: nextChecks.checksHeadSha,
						checks: nextChecks.checks,
						isChecksLoading: nextChecks.isChecksLoading,
						hasResolvedChecks: nextChecks.hasResolvedChecks,
					},
				},
				{ touchUpdatedAt: false }
			);
		}
	}

	private setLinkedPrLoading(projectPath: string, prNumber: number, isLoading: boolean): void {
		const matchingSessions = this.getSessionPrLinkRefs(projectPath, prNumber);

		for (const session of matchingSessions) {
			const nextLinkedPr = session.linkedPr
				? {
						prNumber: session.linkedPr.prNumber,
						state: session.linkedPr.state,
						url: session.linkedPr.url,
						title: session.linkedPr.title,
						additions: session.linkedPr.additions,
						deletions: session.linkedPr.deletions,
						isDraft: session.linkedPr.isDraft,
						isLoading,
						hasResolvedDetails: session.linkedPr.hasResolvedDetails,
						checksHeadSha: session.linkedPr.checksHeadSha,
						checks: session.linkedPr.checks,
						isChecksLoading: session.linkedPr.isChecksLoading,
						hasResolvedChecks: session.linkedPr.hasResolvedChecks,
					}
				: {
						prNumber,
						state: session.prState ?? "OPEN",
						url: null,
						title: null,
						additions: null,
						deletions: null,
						isDraft: null,
						isLoading,
						hasResolvedDetails: false,
						checksHeadSha: null,
						checks: [],
						isChecksLoading: true,
						hasResolvedChecks: false,
					};

			if (
				session.linkedPr?.isLoading === nextLinkedPr.isLoading &&
				session.linkedPr?.hasResolvedDetails === nextLinkedPr.hasResolvedDetails
			) {
				continue;
			}

			this.updateSession(session.sessionId, { linkedPr: nextLinkedPr }, { touchUpdatedAt: false });
		}
	}

	private setLinkedPrChecksLoading(
		projectPath: string,
		prNumber: number,
		isChecksLoading: boolean
	): void {
		const matchingSessions = this.getSessionPrLinkRefs(projectPath, prNumber);

		for (const session of matchingSessions) {
			const linkedPr = session.linkedPr ?? buildPartialSessionLinkedPr(prNumber, session.prState);
			const nextLinkedPr = {
				prNumber: linkedPr.prNumber,
				state: linkedPr.state,
				url: linkedPr.url,
				title: linkedPr.title,
				additions: linkedPr.additions,
				deletions: linkedPr.deletions,
				isDraft: linkedPr.isDraft,
				isLoading: linkedPr.isLoading,
				hasResolvedDetails: linkedPr.hasResolvedDetails,
				checksHeadSha: linkedPr.checksHeadSha,
				checks: linkedPr.checks,
				isChecksLoading,
				hasResolvedChecks: linkedPr.hasResolvedChecks,
			};

			if (
				session.linkedPr?.isChecksLoading === nextLinkedPr.isChecksLoading &&
				session.linkedPr?.hasResolvedChecks === nextLinkedPr.hasResolvedChecks
			) {
				continue;
			}

			this.updateSession(session.sessionId, { linkedPr: nextLinkedPr }, { touchUpdatedAt: false });
		}
	}

	updateUsageTelemetry(
		sessionId: string,
		telemetry: import("./types.js").SessionUsageTelemetry
	): void {
		this.transientProjectionStore.updateTransientProjection(sessionId, { usageTelemetry: telemetry });
	}

	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void {
		const commands = routeSessionStateEnvelope(
			sessionId,
			this.getGraphTranscriptRevision(sessionId),
			envelope
		);

		for (const command of commands) {
			if (command.kind === "replaceGraph") {
				const graph = command.graph;
				const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
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
				this.syncAwaitingModelRefreshTimer(
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
				const lifecycleRevision = {
					graphRevision: envelope.graphRevision,
					transcriptRevision:
						previousProjection?.revision.transcriptRevision ??
						previousGraph?.transcriptSnapshot.revision ??
						0,
					lastEventSeq: envelope.lastEventSeq,
				};
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
				this.canonicalCapabilitiesMaterialized.set(
					sessionId,
					previousCapabilitiesMaterialized
				);
				if (previousGraph !== null) {
					this.sessionStateGraphs.set(
						sessionId,
						graphWithLifecycle(previousGraph, command.lifecycle, reconciledActivity, {
							graphRevision: lifecycleRevision.graphRevision,
							transcriptRevision: previousGraph.revision.transcriptRevision,
							lastEventSeq: lifecycleRevision.lastEventSeq,
						})
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
					acpSessionId: command.lifecycle.status === "ready" ? sessionId : transientProjection.acpSessionId,
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
				this.syncAwaitingModelRefreshTimer(sessionId, reconciledActivity, turnState);
				continue;
			}

			if (command.kind === "applyCapabilities") {
				const sessionIdentity = this.getSessionIdentity(sessionId);
				if (!sessionIdentity) {
					continue;
				}
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				if (!isNewerGraphRevision(previousProjection?.revision ?? null, command.revision)) {
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
				this.callbacks.onPlanUpdate?.(sessionId, command.plan);
				continue;
			}

			if (command.kind === "applyAssistantTextDelta") {
				this.applyAssistantTextDelta(sessionId, command.delta);
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
				const activeTurnFailure = mapProjectionTurnFailure(command.activeTurnFailure);
				this.canonicalProjections.set(sessionId, {
					lifecycle: previousProjection.lifecycle,
					activity: command.activity,
					turnState: command.turnState,
					activeTurnFailure,
					lastTerminalTurnId: command.lastTerminalTurnId,
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
					turnState: command.turnState,
					activeTurnFailure,
					projectedFailure: command.activeTurnFailure,
					lastTerminalTurnId: command.lastTerminalTurnId,
				});
				this.reconcileConnectionMachineFromCanonicalState(
					sessionId,
					previousProjection.lifecycle,
					command.turnState,
					activeTurnFailure
				);
				this.syncAwaitingModelRefreshTimer(sessionId, command.activity, command.turnState);
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

			this.applyTranscriptDelta(sessionId, command.delta);
		}
	}

	applyTranscriptDelta(sessionId: string, delta: TranscriptDelta): void {
		const currentTranscriptRevision = this.getGraphTranscriptRevision(sessionId);
		if (
			currentTranscriptRevision === undefined ||
			delta.snapshotRevision > currentTranscriptRevision
		) {
			const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
			if (previousGraph !== null) {
				const nextSnapshot = applyTranscriptDeltaToSnapshot(
					previousGraph.transcriptSnapshot,
					delta
				);
				this.sessionStateGraphs.set(
					sessionId,
					graphWithTranscriptSnapshot(previousGraph, nextSnapshot)
				);
			}
		}
		this.entryStore.applyTranscriptDelta(sessionId, delta, new Date());
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
		if (previousRow !== null && delta.revision <= previousRow.revision) {
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
		const nextRow: RowTokenStream = {
			turnId: delta.turnId,
			rowId: delta.rowId,
			accumulatedText: nextText,
			wordCount: countWordsInMarkdown(nextText),
			latestWordCount: countWordsInMarkdown(delta.deltaText),
			firstDeltaProducedAtMonotonicMs:
				previousRow?.firstDeltaProducedAtMonotonicMs ?? delta.producedAtMonotonicMs,
			lastDeltaProducedAtMonotonicMs: delta.producedAtMonotonicMs,
			revision: delta.revision,
		};
		const nextTokenStream = cloneRowTokenStreamMap(projection.tokenStream);
		nextTokenStream.set(rowKey, nextRow);
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
		return this.sessionStateGraphs.get(sessionId)?.transcriptSnapshot.revision;
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

	private syncAwaitingModelRefreshTimer(
		sessionId: string,
		activity: SessionGraphActivity,
		turnState: SessionTurnState
	): void {
		this.clearAwaitingModelRefreshTimer(sessionId);
		if (activity.kind !== "awaiting_model" && turnState !== "Running") {
			return;
		}

		const timerId = setTimeout(() => {
			this.awaitingModelRefreshTimers.delete(sessionId);
			const projection = this.canonicalProjections.get(sessionId) ?? null;
			if (
				projection === null ||
				(projection.activity.kind !== "awaiting_model" && projection.turnState !== "Running")
			) {
				return;
			}
			logger.warn("Refreshing session-state snapshot after stale awaiting-model state", {
				sessionId,
				graphRevision: projection.revision.graphRevision,
				lastEventSeq: projection.revision.lastEventSeq,
			});
			void this.refreshSessionStateSnapshot(sessionId).match(
				() => undefined,
				() => undefined
			);
		}, AWAITING_MODEL_SNAPSHOT_REFRESH_MS);
		this.awaitingModelRefreshTimers.set(sessionId, timerId);
	}

	private clearAwaitingModelRefreshTimer(sessionId: string): void {
		const timerId = this.awaitingModelRefreshTimers.get(sessionId);
		if (timerId === undefined) {
			return;
		}
		clearTimeout(timerId);
		this.awaitingModelRefreshTimers.delete(sessionId);
	}

	private clearAllAwaitingModelRefreshTimers(): void {
		for (const timerId of this.awaitingModelRefreshTimers.values()) {
			clearTimeout(timerId);
		}
		this.awaitingModelRefreshTimers.clear();
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
		this.clearAllAwaitingModelRefreshTimers();
	}
}

/**
 * Create and set the session store in Svelte context.
 */
export function createSessionStore(): SessionStore {
	const store = new SessionStore();
	setContext(SESSION_STORE_KEY, store);

	return store;
}

/**
 * Get the session store from Svelte context.
 */
export function getSessionStore(): SessionStore {
	return getContext<SessionStore>(SESSION_STORE_KEY);
}
