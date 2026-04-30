/**
 * Session Store - Consolidated session management.
 *
 * Single source of truth for all session state:
 * - sessions: SessionCold[] (cold data)
 * - hotState: Map<id, SessionTransientProjection> (all transient state)
 * - entriesById: Map<id, SessionEntry[]> (messages)
 * - Event subscription handling (via SessionEventService)
 */

import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import {
	normalizeModelsForDisplay,
	resolveProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type {
	ConfigOptionData as CanonicalConfigOptionData,
	ConfigOptionValue as CanonicalConfigOptionValue,
	FailureReason,
	InteractionSnapshot,
	JsonValue,
	OperationSnapshot,
	OperationState,
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
import type {
	ContentBlock,
	ContentChunk,
	PlanData,
} from "../../services/converted-session-types.js";
import type { Attachment } from "../components/agent-input/types/attachment.js";
import type { AppError } from "../errors/app-error.js";
import type { ComposerMachineEvent } from "../logic/composer-machine.js";
import { deriveStoreComposerState, type StoreComposerState } from "../logic/composer-ui-state.js";
import type { SessionMachineSnapshot } from "../logic/session-machine";
import {
	deriveSessionRuntimeState,
	deriveSessionUIState,
	type SessionRuntimeState,
	type SessionUIState,
} from "../logic/session-ui-state";
import { routeSessionStateEnvelope } from "../session-state/session-state-command-router.js";
import { materializeSnapshotFromOpenFound } from "../session-state/session-state-protocol.js";
import type { AvailableCommand } from "../types/available-command.js";
import type { SessionUpdate } from "../types/session-update";
import type {
	ActiveTurnFailure,
	TurnCompleteUpdate,
	TurnErrorUpdate,
} from "../types/turn-error.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import { ComposerMachineService } from "./composer-machine-service.svelte.js";
import type { ISessionStateReader, ISessionStateWriter } from "./services/interfaces/index.js";
import {
	SessionConnectionService,
	type SessionMachineActor,
} from "./session-connection-service.svelte.js";
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
	SessionEntry,
	SessionIdentity,
	SessionLinkedPr,
	SessionMetadata,
	SessionPrLinkMode,
	SessionTransientProjection,
	SessionUsageTelemetry,
} from "./types.js";
import "../errors/app-error.js";
import type { GitStackedPrStep, PrChecks, PrDetails } from "../../utils/tauri-client/git.js";
import { tauriClient } from "../../utils/tauri-client.js";
import { buildPartialSessionLinkedPr } from "../application/dto/session-linked-pr.js";
import { normalizeModeIdForUI } from "../constants/mode-mapping.js";
import { ConnectionError, SessionNotFoundError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import * as preferencesStore from "./agent-model-preferences-store.svelte.js";
import { api } from "./api.js";
import { OperationStore } from "./operation-store.svelte.js";
import {
	canActivateCreatedSessionWithFirstPrompt,
	isPreCanonicalCreatedSession,
} from "./services/first-send-activation.js";
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

function mapTurnStateToHotState(
	turnState: SessionTurnState
): "idle" | "streaming" | "completed" | "error" {
	switch (turnState) {
		case "Idle":
			return "idle";
		case "Running":
			return "streaming";
		case "Completed":
			return "completed";
		case "Failed":
			return "error";
	}
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
	"activeTurnFailure",
	"lastTerminalTurnId",
	"lifecycle",
	"activity",
	"capabilities",
] as const satisfies readonly (keyof SessionStateGraph)[];

type SessionStateGraphCopyKey = (typeof SESSION_STATE_GRAPH_COPY_KEYS)[number];
type MissingSessionStateGraphCopyKey = Exclude<keyof SessionStateGraph, SessionStateGraphCopyKey>;

function assertSessionStateGraphCopyKeyCoverage(
	_coverage: Record<MissingSessionStateGraphCopyKey, never>
): void {}

assertSessionStateGraphCopyKeyCoverage({});

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
		activeTurnFailure: graph.activeTurnFailure ?? null,
		lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
		lifecycle: graph.lifecycle,
		activity: graph.activity,
		capabilities,
	};
}

function isTerminalOperationSnapshotState(state: OperationState): boolean {
	switch (state) {
		case "completed":
		case "failed":
		case "cancelled":
		case "degraded":
			return true;
		case "pending":
		case "running":
		case "blocked":
			return false;
	}
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
		if (
			existing !== undefined &&
			isTerminalOperationSnapshotState(existing.operation_state) &&
			!isTerminalOperationSnapshotState(patch.operation_state)
		) {
			continue;
		}
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

function normalizeCanonicalAgentId(agentId: SessionOpenFound["agentId"]): string {
	return typeof agentId === "string" ? agentId : agentId.custom;
}

function mapGraphAvailableModels(capabilities: SessionGraphCapabilities): Array<Model> {
	const availableModels = capabilities.models?.availableModels ?? [];
	return availableModels.map((model) => ({
		id: model.modelId,
		name: model.name,
		description: model.description ?? undefined,
	}));
}

function mapGraphAvailableModes(capabilities: SessionGraphCapabilities): Array<Mode> {
	const availableModes = capabilities.modes?.availableModes ?? [];
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
		availableCommands: [],
		configOptions: [],
		autonomousEnabled: false,
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
		availableCommands: capabilities.availableCommands ?? [],
		configOptions: sanitizeCanonicalConfigOptions(capabilities.configOptions ?? []),
		autonomousEnabled: capabilities.autonomousEnabled ?? false,
	};
}

function mergeCanonicalCapabilities(
	incoming: SessionGraphCapabilities,
	previous: SessionGraphCapabilities | null
): SessionGraphCapabilities {
	const sanitizedIncoming = sanitizeCanonicalCapabilities(incoming);
	return {
		models: incoming.models == null ? (previous?.models ?? null) : sanitizedIncoming.models,
		modes: incoming.modes == null ? (previous?.modes ?? null) : sanitizedIncoming.modes,
		availableCommands: sanitizedIncoming.availableCommands ?? [],
		configOptions: sanitizedIncoming.configOptions ?? [],
		autonomousEnabled: sanitizedIncoming.autonomousEnabled ?? false,
	};
}

function projectGraphCapabilities(
	agentId: string,
	capabilities: SessionGraphCapabilities
): {
	availableModels: Array<Model>;
	availableModes: Array<Mode>;
	availableCommands: AvailableCommand[];
	currentModel: Model | null;
	currentMode: Mode | null;
	modelsDisplay: ModelsForDisplay | undefined;
	providerMetadata: ProviderMetadataProjection;
	configOptions: ReadonlyArray<CanonicalConfigOptionData>;
	autonomousEnabled: boolean;
} {
	const availableModels = mapGraphAvailableModels(capabilities);
	const availableModes = mapGraphAvailableModes(capabilities);
	const providerMetadata = resolveProviderMetadataProjection(
		agentId,
		capabilities.models?.providerMetadata ?? null,
		agentId
	);
	const normalizedModelsDisplay =
		normalizeModelsForDisplay(
			agentId,
			capabilities.models?.modelsDisplay ?? null,
			agentId,
			providerMetadata
		) ?? null;
	const modelsDisplay = normalizedModelsDisplay === null ? undefined : normalizedModelsDisplay;
	const normalizedCurrentModeId = capabilities.modes?.currentModeId
		? normalizeModeIdForUI(capabilities.modes.currentModeId, agentId)
		: null;
	const currentMode =
		normalizedCurrentModeId === null
			? null
			: (availableModes.find((mode) => mode.id === normalizedCurrentModeId) ?? null);
	const currentModelId = capabilities.models?.currentModelId ?? null;
	const currentModel =
		currentModelId === null
			? null
			: (availableModels.find((model) => model.id === currentModelId) ?? null);

	return {
		availableModels,
		availableModes,
		availableCommands: capabilities.availableCommands ?? [],
		currentModel,
		currentMode,
		modelsDisplay,
		providerMetadata,
		configOptions: capabilities.configOptions ?? [],
		autonomousEnabled: capabilities.autonomousEnabled ?? false,
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

function mergeProjectedCapabilities(
	agentId: string,
	capabilities: SessionGraphCapabilities,
	previousCapabilities: SessionGraphCapabilities | null
): ProjectedGraphCapabilities {
	const projectedCapabilities = projectGraphCapabilities(
		agentId,
		sanitizeCanonicalCapabilities(capabilities)
	);
	const previousProjectedCapabilities =
		previousCapabilities === null ? null : projectGraphCapabilities(agentId, previousCapabilities);
	const shouldPreserveModels =
		capabilities.models == null &&
		previousProjectedCapabilities !== null &&
		previousProjectedCapabilities.availableModels.length > 0;
	const shouldPreserveModes =
		capabilities.modes == null &&
		previousProjectedCapabilities !== null &&
		previousProjectedCapabilities.availableModes.length > 0;

	return {
		availableModels: shouldPreserveModels
			? previousProjectedCapabilities.availableModels.map((model) => ({
					id: model.id,
					name: model.name,
					description: model.description,
				}))
			: projectedCapabilities.availableModels,
		availableModes: shouldPreserveModes
			? previousProjectedCapabilities.availableModes.map((mode) => ({
					id: mode.id,
					name: mode.name,
					description: mode.description,
				}))
			: projectedCapabilities.availableModes,
		availableCommands: projectedCapabilities.availableCommands,
		currentModel: shouldPreserveModels
			? previousProjectedCapabilities.currentModel
			: projectedCapabilities.currentModel,
		currentMode: shouldPreserveModes
			? previousProjectedCapabilities.currentMode
			: projectedCapabilities.currentMode,
		modelsDisplay: shouldPreserveModels
			? previousProjectedCapabilities.modelsDisplay
			: projectedCapabilities.modelsDisplay,
		providerMetadata: shouldPreserveModels
			? previousProjectedCapabilities.providerMetadata
			: projectedCapabilities.providerMetadata,
		configOptions: projectedCapabilities.configOptions,
		autonomousEnabled: projectedCapabilities.autonomousEnabled,
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

function canonicalProjectionResolvesPendingSendIntent(
	lifecycle: SessionGraphLifecycle,
	turnState: SessionTurnState,
	activeTurnFailure: ActiveTurnFailure | null
): boolean {
	return (
		lifecycle.actionability.canSend ||
		lifecycle.status === "activating" ||
		lifecycle.status === "reconnecting" ||
		lifecycle.status === "detached" ||
		lifecycle.status === "failed" ||
		lifecycle.status === "archived" ||
		turnState === "Running" ||
		turnState === "Completed" ||
		turnState === "Failed" ||
		activeTurnFailure !== null
	);
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

	// Hot state store (batched transient state)
	private readonly hotStateStore = new SessionTransientProjectionStore();

	// Canonical graph selector state for lifecycle/activity/actionability consumers.
	private readonly canonicalProjections = new SvelteMap<string, CanonicalSessionProjection>();
	private readonly sessionStateGraphs = new SvelteMap<string, SessionStateGraph>();
	private readonly pendingCreationSessions = new SvelteMap<string, CreatedPendingSessionResult>();

	// Canonical tool execution domain state
	private readonly operationStore = new OperationStore();

	// Entry store (entries + chunk aggregation)
	private readonly entryStore = new SessionEntryStore(this.operationStore);
	private sessionOpenHydrator: CreatedSessionHydrator | null = null;
	private liveSessionStateGraphConsumer: LiveSessionStateGraphConsumer | null = null;
	private readonly inflightSessionStateRefreshes = new Map<string, InflightSessionStateRefresh>();

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
			this.hotStateStore,
			this.entryStore,
			this.connectionService,
			this.eventService
		);
		// Create messaging service
		this.messagingSvc = new SessionMessagingService(
			this,
			this.hotStateStore,
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
	 * Get hot state for a session.
	 */
	getHotState(sessionId: string): SessionTransientProjection {
		return this.hotStateStore.getHotState(sessionId);
	}

	/**
	 * Get canonical graph projection for lifecycle/activity UI selectors.
	 */
	getCanonicalSessionProjection(sessionId: string): CanonicalSessionProjection | null {
		return this.canonicalProjections.get(sessionId) ?? null;
	}

	getSessionStateGraph(sessionId: string): SessionStateGraph | null {
		return this.sessionStateGraphs.get(sessionId) ?? null;
	}

	hasPendingCreationSession(sessionId: string): boolean {
		return this.pendingCreationSessions.has(sessionId);
	}

	getSessionCanSend(sessionId: string): boolean | null {
		return this.canonicalProjections.get(sessionId)?.lifecycle.actionability.canSend ?? null;
	}

	getSessionLifecycleStatus(sessionId: string): SessionGraphLifecycle["status"] | null {
		return this.canonicalProjections.get(sessionId)?.lifecycle.status ?? null;
	}

	private getCanonicalProjectedCapabilities(sessionId: string): ProjectedGraphCapabilities | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		const session = this.getSessionCold(sessionId);
		if (projection === null || session === undefined) {
			return null;
		}
		return projectGraphCapabilities(session.agentId, projection.capabilities);
	}

	/**
	 * Canonical turn state; null means no canonical projection exists yet.
	 */
	getSessionTurnState(sessionId: string): SessionTurnState | null {
		return this.canonicalProjections.get(sessionId)?.turnState ?? null;
	}

	/**
	 * Canonical connection error copy; null means no canonical failure/detach message exists yet.
	 */
	getSessionConnectionError(sessionId: string): string | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		if (projection === null) {
			return null;
		}
		return connectionErrorFromGraphState(projection.lifecycle, projection.activeTurnFailure);
	}

	/**
	 * Canonical lifecycle failure classification, or null when the lifecycle is
	 * not in a failed state. Used by the panel error UI to compose curated
	 * user-facing copy keyed on `(agentId, failureReason)` while keeping the
	 * raw provider text under `getSessionConnectionError` for debug surfaces.
	 */
	getSessionLifecycleFailureReason(sessionId: string): FailureReason | null {
		const lifecycle = this.canonicalProjections.get(sessionId)?.lifecycle ?? null;
		if (lifecycle === null) {
			return null;
		}
		if (lifecycle.status !== "failed" && lifecycle.status !== "detached") {
			return null;
		}
		return lifecycle.failureReason ?? null;
	}

	/**
	 * Canonical active turn failure; null means no canonical projection or no active failure.
	 */
	getSessionActiveTurnFailure(sessionId: string): ActiveTurnFailure | null {
		return this.canonicalProjections.get(sessionId)?.activeTurnFailure ?? null;
	}

	/**
	 * Canonical last terminal turn id; null means no canonical projection or no terminal turn.
	 */
	getSessionLastTerminalTurnId(sessionId: string): string | null {
		return this.canonicalProjections.get(sessionId)?.lastTerminalTurnId ?? null;
	}

	/**
	 * Canonical autonomous setting; false means no canonical projection or no autonomous capability.
	 */
	getSessionAutonomousEnabled(sessionId: string): boolean {
		return this.canonicalProjections.get(sessionId)?.capabilities.autonomousEnabled ?? false;
	}

	/**
	 * Canonical current mode id; null means no canonical projection or no selected mode.
	 */
	getSessionCurrentModeId(sessionId: string): string | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.currentMode?.id ?? null;
	}

	/**
	 * Canonical current model id; null means no canonical projection or no selected model.
	 */
	getSessionCurrentModelId(sessionId: string): string | null {
		return this.getCanonicalProjectedCapabilities(sessionId)?.currentModel?.id ?? null;
	}

	/**
	 * Canonical available commands; empty means no canonical projection or no commands.
	 */
	getSessionAvailableCommands(sessionId: string): ReadonlyArray<AvailableCommand> {
		return this.getCanonicalProjectedCapabilities(sessionId)?.availableCommands ?? [];
	}

	/**
	 * Canonical config options; empty means no canonical projection or no config options.
	 */
	getSessionConfigOptions(sessionId: string): ReadonlyArray<CanonicalConfigOptionData> {
		return this.getCanonicalProjectedCapabilities(sessionId)?.configOptions ?? [];
	}

	/**
	 * Canonical available models; empty means no canonical projection or no models.
	 */
	getSessionAvailableModels(sessionId: string): ReadonlyArray<Model> {
		return this.getCanonicalProjectedCapabilities(sessionId)?.availableModels ?? [];
	}

	/**
	 * Canonical available modes; empty means no canonical projection or no modes.
	 */
	getSessionAvailableModes(sessionId: string): ReadonlyArray<Mode> {
		return this.getCanonicalProjectedCapabilities(sessionId)?.availableModes ?? [];
	}

	/**
	 * Canonical-derived flat capability view; empty means no canonical projection yet.
	 */
	getSessionCapabilities(sessionId: string): SessionCapabilities {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		const projectedCapabilities = this.getCanonicalProjectedCapabilities(sessionId);
		if (projection === null || projectedCapabilities === null) {
			return {
				availableModels: [],
				availableModes: [],
				availableCommands: [],
				revision: null,
				pendingMutationId: null,
				previewState: "partial",
			};
		}

		const mutationState = this.getHotState(sessionId).capabilityMutationState ?? {
			pendingMutationId: null,
			previewState: null,
		};
		return {
			availableModels: projectedCapabilities.availableModels,
			availableModes: projectedCapabilities.availableModes,
			availableCommands: projectedCapabilities.availableCommands,
			revision: projection.revision,
			pendingMutationId: mutationState.pendingMutationId,
			previewState:
				mutationState.previewState ?? deriveCapabilityPreviewState(projection.capabilities),
			modelsDisplay: projectedCapabilities.modelsDisplay,
			providerMetadata: projectedCapabilities.providerMetadata,
		};
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
		return this.sessionById.get(sessionId);
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
		const session = this.getSessionCold(sessionId);
		if (!session) {
			return null;
		}
		if (!this.entryStore.isPreloaded(sessionId)) {
			return null;
		}
		return session;
	}

	/**
	 * Get entries for a session.
	 */
	getEntries(sessionId: string): SessionEntry[] {
		return this.entryStore.getEntries(sessionId);
	}

	getOperationStore(): OperationStore {
		return this.operationStore;
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
	 * Get session machine for a session.
	 */
	getSessionMachine(sessionId: string): SessionMachineActor | null {
		return this.connectionService.getMachine(sessionId);
	}

	/**
	 * Get session machine state.
	 */
	getSessionState(sessionId: string): SessionMachineSnapshot | null {
		return this.connectionService.getState(sessionId);
	}

	/**
	 * Get derived UI state for a session.
	 * Derives directly from the XState machine - single source of truth.
	 */
	getSessionUIState(sessionId: string): SessionUIState | null {
		const state = this.connectionService.getState(sessionId);
		if (!state) return null;
		return deriveSessionUIState(state);
	}

	/**
	 * Get canonical runtime state for a session.
	 * This is the single lifecycle contract for panel/input/queue consumers.
	 */
	getSessionRuntimeState(sessionId: string): SessionRuntimeState | null {
		// Reactive anchor: XState machine snapshots are imperative (plain Map),
		// invisible to Svelte's signal graph. Every machine transition is paired
		// with a hot-state update, so reading hot state here ensures $derived
		// callers re-evaluate when the machine moves.

		const hotState = this.hotStateStore.getHotState(sessionId);

		const state = this.connectionService.getState(sessionId);
		if (!state) return null;
		const runtimeState = deriveSessionRuntimeState(state);
		if (hotState.pendingSendIntent === null || hotState.pendingSendIntent === undefined) {
			return runtimeState;
		}
		return {
			connectionPhase: runtimeState.connectionPhase,
			contentPhase: runtimeState.contentPhase,
			activityPhase: runtimeState.activityPhase,
			canSubmit: false,
			canCancel: runtimeState.canCancel,
			showStop: runtimeState.showStop,
			showThinking: runtimeState.showThinking,
			showConnectingOverlay: runtimeState.showConnectingOverlay,
			showConversation: runtimeState.showConversation,
			showReadyPlaceholder: runtimeState.showReadyPlaceholder,
		};
	}

	/**
	 * Canonical composer policy for a session (config block, dispatch, selector disables).
	 * Reactive: subscribes to composer machine snapshots and runtime state.
	 */
	getStoreComposerState(sessionId: string): StoreComposerState | null {
		this.hotStateStore.getHotState(sessionId);
		const snapshot = this.composerMachineService.getState(sessionId);
		if (!snapshot) {
			return null;
		}
		return deriveStoreComposerState({
			machineSnapshot: snapshot,
			runtime: this.getSessionRuntimeState(sessionId),
		});
	}

	/**
	 * Re-seed composer committed state from hot state (call when panel binds / session changes).
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
		const previousHotState = this.getHotState(graph.canonicalSessionId);
		const previousProjection = this.canonicalProjections.get(graph.canonicalSessionId) ?? null;
		this.sessionStateGraphs.set(graph.canonicalSessionId, graph);
		const canonicalCapabilities = sanitizeCanonicalCapabilities(graph.capabilities);
		const activeTurnFailure = mapProjectionTurnFailure(graph.activeTurnFailure ?? null);
		const nextLastTerminalTurnId = graph.lastTerminalTurnId ?? null;
		this.canonicalProjections.set(graph.canonicalSessionId, {
			lifecycle: graph.lifecycle,
			activity: graph.activity,
			turnState: graph.turnState,
			activeTurnFailure,
			lastTerminalTurnId: nextLastTerminalTurnId,
			capabilities: canonicalCapabilities,
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
			previousHotState.pendingSendIntent !== null &&
			previousHotState.pendingSendIntent !== undefined &&
			canonicalProjectionResolvesPendingSendIntent(graph.lifecycle, graph.turnState, activeTurnFailure)
		) {
			updates.pendingSendIntent = null;
		}
		if (previousHotState.autonomousTransition !== "idle") {
			updates.autonomousTransition = "idle";
		}

		this.hotStateStore.updateHotState(graph.canonicalSessionId, updates);
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
			input.turnState === "Completed" &&
			(input.previousProjection?.turnState !== "Completed" ||
				input.previousProjection.lastTerminalTurnId !== input.lastTerminalTurnId);
		const isNewFailedTurn =
			input.turnState === "Failed" &&
			input.activeTurnFailure !== null &&
			(input.previousProjection?.turnState !== "Failed" ||
				input.previousProjection.lastTerminalTurnId !== input.lastTerminalTurnId);

		if (isNewCompletedTurn) {
			this.messagingSvc.handleStreamComplete(input.sessionId, input.lastTerminalTurnId ?? undefined);
			this.callbacks.onTurnComplete?.(input.sessionId);
		}

		if (!isNewFailedTurn || input.projectedFailure === null) {
			return;
		}

		const numericCode =
			input.projectedFailure.code == null || input.projectedFailure.code.trim() === ""
				? undefined
				: Number.isNaN(Number(input.projectedFailure.code))
					? undefined
					: Number(input.projectedFailure.code);
		this.messagingSvc.handleTurnError(input.sessionId, {
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
		let machineState = this.connectionService.getState(sessionId);

		if (
			lifecycle.status === "reserved" ||
			lifecycle.status === "detached" ||
			lifecycle.status === "archived"
		) {
			if (machineState !== null && machineState.connection !== "disconnected") {
				this.connectionService.sendDisconnect(sessionId);
			}
			return;
		}

		if (lifecycle.status === "activating" || lifecycle.status === "reconnecting") {
			if (machineState === null || machineState.connection === "disconnected") {
				this.connectionService.sendConnectionConnect(sessionId);
			}
			return;
		}

		if (lifecycle.status === "failed") {
			if (machineState === null || machineState.connection === "disconnected") {
				this.connectionService.sendConnectionConnect(sessionId);
			}
			this.connectionService.sendConnectionError(sessionId);
			return;
		}

		if (machineState === null || machineState.connection === "disconnected") {
			this.connectionService.sendConnectionConnect(sessionId);
			this.connectionService.sendConnectionSuccess(sessionId);
			this.connectionService.sendCapabilitiesLoaded(sessionId);
			machineState = this.connectionService.getState(sessionId);
		} else if (machineState.connection === "connecting") {
			this.connectionService.sendConnectionSuccess(sessionId);
			this.connectionService.sendCapabilitiesLoaded(sessionId);
			machineState = this.connectionService.getState(sessionId);
		} else if (machineState.connection === "warmingUp") {
			this.connectionService.sendCapabilitiesLoaded(sessionId);
			machineState = this.connectionService.getState(sessionId);
		} else if (machineState.connection === "error") {
			this.connectionService.sendDisconnect(sessionId);
			this.connectionService.sendConnectionConnect(sessionId);
			this.connectionService.sendConnectionSuccess(sessionId);
			this.connectionService.sendCapabilitiesLoaded(sessionId);
			machineState = this.connectionService.getState(sessionId);
		}

		if (machineState === null) {
			return;
		}

		if (turnState === "Running") {
			if (machineState.connection === "ready") {
				this.connectionService.sendMessageSent(sessionId);
				this.connectionService.sendResponseStarted(sessionId);
				return;
			}

			if (machineState.connection === "awaitingResponse") {
				this.connectionService.sendResponseStarted(sessionId);
			}
			return;
		}

		if (turnState === "Failed" && activeTurnFailure !== null) {
			if (
				machineState.connection === "awaitingResponse" ||
				machineState.connection === "streaming" ||
				machineState.connection === "paused"
			) {
				this.connectionService.sendTurnFailed(sessionId, activeTurnFailure);
			}
			return;
		}

		if (
			machineState.connection === "awaitingResponse" ||
			machineState.connection === "streaming" ||
			machineState.connection === "paused"
		) {
			this.connectionService.sendResponseComplete(sessionId);
		}
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
		this.hotStateStore.removeHotState(sessionId);
		this.canonicalProjections.delete(sessionId);
		this.sessionStateGraphs.delete(sessionId);
		this.messagingSvc.clearSessionState(sessionId);
		this.composerMachineService.removeMachine(sessionId);
		preferencesStore.clearSessionModelPerMode(sessionId);
		for (const cb of this.onRemoveCallbacks) {
			cb(sessionId);
		}
	}

	/**
	 * Clear cached entries/runtime for a session without removing session metadata.
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
		const aliasSession =
			snapshot.isAlias && requestedSessionId !== canonicalSessionId
				? this.getSessionCold(requestedSessionId)
				: undefined;
		const canonicalSession = this.getSessionCold(canonicalSessionId);
		const preservedSession = canonicalSession ?? aliasSession;
		const now = new Date();
		const nextSessionLifecycleState =
			snapshot.sourcePath !== null
				? "persisted"
				: (preservedSession?.sessionLifecycleState ?? "created");

		if (aliasSession && requestedSessionId !== canonicalSessionId) {
			this.removeSession(requestedSessionId);
		}

		if (canonicalSession) {
			this.updateSession(
				canonicalSessionId,
				{
					projectPath: snapshot.projectPath,
					agentId: normalizeCanonicalAgentId(snapshot.agentId),
					worktreePath: snapshot.worktreePath ?? undefined,
					title: snapshot.sessionTitle,
					sourcePath: snapshot.sourcePath ?? undefined,
					sessionLifecycleState: nextSessionLifecycleState,
				},
				{ touchUpdatedAt: false }
			);
		} else {
			this.addSession({
				id: canonicalSessionId,
				projectPath: snapshot.projectPath,
				agentId: normalizeCanonicalAgentId(snapshot.agentId),
				worktreePath: snapshot.worktreePath ?? undefined,
				title: snapshot.sessionTitle,
				updatedAt: preservedSession?.updatedAt ?? now,
				createdAt: preservedSession?.createdAt ?? now,
				sourcePath: snapshot.sourcePath ?? undefined,
				sessionLifecycleState: nextSessionLifecycleState,
				parentId: preservedSession?.parentId ?? null,
			});
		}

		this.operationStore.replaceSessionOperations(canonicalSessionId, snapshot.operations);
		this.entryStore.replaceTranscriptSnapshot(canonicalSessionId, snapshot.transcriptSnapshot, now);
		this.hotStateStore.initializeHotState(canonicalSessionId);
		const graph = materializeSnapshotFromOpenFound(snapshot).graph;
		this.sessionStateGraphs.set(canonicalSessionId, graph);
		const canonicalCapabilities = sanitizeCanonicalCapabilities(graph.capabilities);
		this.hotStateStore.updateHotState(canonicalSessionId, {
			statusChangedAt: Date.now(),
			capabilityMutationState: {
				pendingMutationId: null,
				previewState: deriveCapabilityPreviewState(canonicalCapabilities),
			},
		});
		// Populate canonical projection from the backend-authored open snapshot
		// so downstream readers never synthesize lifecycle from hot state.
		this.canonicalProjections.set(canonicalSessionId, {
			lifecycle: graph.lifecycle,
			activity: graph.activity,
			turnState: snapshot.turnState,
			activeTurnFailure: mapProjectionTurnFailure(snapshot.activeTurnFailure ?? null),
			lastTerminalTurnId: snapshot.lastTerminalTurnId ?? null,
			capabilities: canonicalCapabilities,
			revision: graph.revision,
		});
		this.connectionService.sendContentLoad(canonicalSessionId);
		this.connectionService.sendContentLoaded(canonicalSessionId);
	}

	ensureSessionFromStateGraph(graph: SessionStateGraph): boolean {
		const sessionId = graph.canonicalSessionId;
		if (this.getSessionCold(sessionId)) {
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
			agentId: normalizeCanonicalAgentId(graph.agentId),
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
		this.messagingSvc.handleTurnError(sessionId, update);
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
		updates: Partial<SessionCold>,
		options?: { touchUpdatedAt?: boolean }
	): void {
		this.sessions = this.sessions.map((s) =>
			s.id === id
				? {
						...s,
						...updates,
						updatedAt:
							updates.updatedAt !== undefined
								? updates.updatedAt
								: options?.touchUpdatedAt === false
									? s.updatedAt
									: new Date(),
					}
				: s
		);
	}

	renameSession(sessionId: string, title: string): ResultAsync<void, AppError> {
		const session = this.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const trimmedTitle = title.trim();
		if (trimmedTitle === "" || trimmedTitle === session.title) {
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
		if (this.getSessionCold(sessionId)) {
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
	}

	/**
	 * Disconnect all connected sessions.
	 * Used for cleanup when the app window closes.
	 */
	disconnectAllSessions(): void {
		const connectedSessions = this.sessions.filter((s) => this.getSessionCanSend(s.id) ?? false);
		for (const session of connectedSessions) {
			this.disconnectSession(session.id);
		}
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
		const session = this.getSessionCold(sessionId);
		if (!session) {
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
		logger.info("sendMessage: store entrypoint", {
			sessionId,
			canSend: this.getSessionCanSend(sessionId) ?? false,
			entryCountBeforeSend: this.entryStore.getEntries(sessionId).length,
			preview: content.trim().slice(0, 120),
		});

		const send = () =>
			this.messagingSvc.sendMessage(sessionId, content, attachments).map(() => {
				const currentTitle = this.getSessionCold(sessionId)?.title;
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

		const canSend = this.getSessionCanSend(sessionId) ?? false;
		const lifecycleStatus = this.getSessionLifecycleStatus(sessionId);
		const canActivateFirstPrompt = canActivateCreatedSessionWithFirstPrompt({
			session,
			lifecycleStatus,
		});

		if (canSend || canActivateFirstPrompt) {
			return send();
		}
		if (isPreCanonicalCreatedSession({ session, lifecycleStatus })) {
			return errAsync(new ConnectionError(sessionId));
		}

		return this.connectSession(sessionId).andThen(() => send());
	}

	// ============================================
	// STREAMING (delegated to messaging service)
	// ============================================

	/**
	 * Handle incoming stream entry from Tauri events.
	 */
	handleStreamEntry(sessionId: string, entry: SessionEntry): void {
		this.messagingSvc.handleStreamEntry(sessionId, entry);
	}

	/**
	 * Handle stream complete from Tauri events.
	 */
	handleStreamComplete(sessionId: string, turnId?: TurnCompleteUpdate["turn_id"]): void {
		this.messagingSvc.handleStreamComplete(sessionId, turnId);
	}

	/**
	 * Handle stream error from Tauri events.
	 */
	handleStreamError(sessionId: string, error: Error): void {
		this.messagingSvc.handleStreamError(sessionId, error);
	}

	/**
	 * Handle turn error from agent (e.g., usage limit reached).
	 */
	handleTurnError(sessionId: string, update: TurnErrorUpdate): void {
		this.messagingSvc.handleTurnError(sessionId, update);
		this.callbacks.onTurnError?.(sessionId);
	}

	clearStreamingAssistantEntry(sessionId: string): void {
		this.entryStore.clearStreamingAssistantEntry(sessionId);
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
		const session = this.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const nextLinkedPr =
			prNumber == null
				? undefined
				: session.linkedPr?.prNumber === prNumber
					? {
							prNumber: session.linkedPr.prNumber,
							state: session.linkedPr.state,
							url: session.linkedPr.url,
							title: session.linkedPr.title,
							additions: session.linkedPr.additions,
							deletions: session.linkedPr.deletions,
							isDraft: session.linkedPr.isDraft,
							isLoading: session.linkedPr.isLoading,
							hasResolvedDetails: session.linkedPr.hasResolvedDetails,
							checksHeadSha: session.linkedPr.checksHeadSha,
							checks: session.linkedPr.checks,
							isChecksLoading: session.linkedPr.isChecksLoading,
							hasResolvedChecks: session.linkedPr.hasResolvedChecks,
						}
					: buildPartialSessionLinkedPr(prNumber, session.prState);
		const nextPrState =
			prNumber == null ? undefined : nextLinkedPr ? nextLinkedPr.state : session.prState;

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

			const session = this.getSessionCold(sessionId);
			if (!session || session.prLinkMode === "manual") {
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
		const sessionsWithPr = this.sessions.filter((s) => s.prNumber != null);
		for (const session of sessionsWithPr) {
			const prNumber = session.prNumber;
			if (prNumber == null) {
				continue;
			}
			void this.refreshSessionPrState(session.id, session.projectPath, prNumber);
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

	private applyPrDetailsToSessions(
		projectPath: string,
		prNumber: number,
		details: PrDetails
	): void {
		const matchingSessions = this.sessions.filter(
			(session) => session.projectPath === projectPath && session.prNumber === prNumber
		);

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
					sessionId: session.id,
					oldState: session.prState,
					newState: details.state,
				});
				this.updateSession(
					session.id,
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
		const matchingSessions = this.sessions.filter(
			(session) => session.projectPath === projectPath && session.prNumber === prNumber
		);

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
				session.id,
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
		const matchingSessions = this.sessions.filter(
			(session) => session.projectPath === projectPath && session.prNumber === prNumber
		);

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

			this.updateSession(session.id, { linkedPr: nextLinkedPr }, { touchUpdatedAt: false });
		}
	}

	private setLinkedPrChecksLoading(
		projectPath: string,
		prNumber: number,
		isChecksLoading: boolean
	): void {
		const matchingSessions = this.sessions.filter(
			(session) => session.projectPath === projectPath && session.prNumber === prNumber
		);

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

			this.updateSession(session.id, { linkedPr: nextLinkedPr }, { touchUpdatedAt: false });
		}
	}

	updateUsageTelemetry(
		sessionId: string,
		telemetry: import("./types.js").SessionUsageTelemetry
	): void {
		this.hotStateStore.updateHotState(sessionId, { usageTelemetry: telemetry });
	}

	/**
	 * Handle session update from EventSubscriber.
	 */
	handleSessionUpdate(update: SessionUpdate): void {
		this.eventService.handleSessionUpdate(update, this);
	}

	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void {
		const commands = routeSessionStateEnvelope(
			sessionId,
			this.entryStore.getTranscriptRevision(sessionId),
			envelope
		);

		for (const command of commands) {
			if (command.kind === "replaceGraph") {
				const graph = command.graph;
				const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
				const currentTranscriptRevision = this.entryStore.getTranscriptRevision(sessionId);
				const incomingTranscriptRevision = graph.transcriptSnapshot.revision;
				const shouldReplaceTranscriptSnapshot =
					currentTranscriptRevision === undefined ||
					incomingTranscriptRevision > currentTranscriptRevision;
				this.operationStore.replaceSessionOperations(sessionId, graph.operations);
				if (shouldReplaceTranscriptSnapshot) {
					this.entryStore.replaceTranscriptSnapshot(
						sessionId,
						graph.transcriptSnapshot,
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
						? graph
						: graphWithTranscriptSnapshot(graph, previousGraph.transcriptSnapshot);
				this.liveSessionStateGraphConsumer?.replaceSessionStateGraph(projectionGraph);
				this.applySessionStateGraph(projectionGraph);
				continue;
			}

			if (command.kind === "applyLifecycle") {
				const hotState = this.getHotState(sessionId);
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				// Carry forward canonical turnState and activeTurnFailure from the previous full-graph
				// projection. Reading these from hotState would feed optimistic messaging-service writes
				// back into the canonical projection (authority inversion).
				const turnState = previousProjection?.turnState ?? "Idle";
				const activeTurnFailure = previousProjection?.activeTurnFailure ?? null;
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
				this.canonicalProjections.set(sessionId, {
					lifecycle: command.lifecycle,
					activity: reconciledActivity,
					turnState,
					activeTurnFailure,
					lastTerminalTurnId: previousProjection?.lastTerminalTurnId ?? null,
					capabilities: previousProjection?.capabilities ?? emptySessionGraphCapabilities(),
					revision: {
						graphRevision: envelope.graphRevision,
						transcriptRevision:
							previousProjection?.revision.transcriptRevision ??
							this.entryStore.getTranscriptRevision(sessionId) ??
							0,
						lastEventSeq: envelope.lastEventSeq,
					},
				});
				const previousGraph = this.sessionStateGraphs.get(sessionId) ?? null;
				if (previousGraph !== null) {
					this.sessionStateGraphs.set(
						sessionId,
						graphWithLifecycle(previousGraph, command.lifecycle, reconciledActivity, {
							graphRevision: envelope.graphRevision,
							transcriptRevision: previousGraph.revision.transcriptRevision,
							lastEventSeq: envelope.lastEventSeq,
						})
					);
				}
				const updates: SessionTransientProjectionUpdates = {
					acpSessionId: command.lifecycle.status === "ready" ? sessionId : hotState.acpSessionId,
				};
				if (previousProjection?.lifecycle.status !== command.lifecycle.status) {
					updates.statusChangedAt = Date.now();
				}
				if (
					hotState.pendingSendIntent !== null &&
					hotState.pendingSendIntent !== undefined &&
					canonicalProjectionResolvesPendingSendIntent(
						command.lifecycle,
						turnState,
						activeTurnFailure
					)
				) {
					updates.pendingSendIntent = null;
				}
				this.hotStateStore.updateHotState(sessionId, updates);
				this.reconcileConnectionMachineFromCanonicalState(
					sessionId,
					command.lifecycle,
					turnState,
					activeTurnFailure
				);
				continue;
			}

			if (command.kind === "applyCapabilities") {
				const session = this.getSessionCold(sessionId);
				if (!session) {
					continue;
				}
				const previousProjection = this.canonicalProjections.get(sessionId) ?? null;
				if (!isNewerGraphRevision(previousProjection?.revision ?? null, command.revision)) {
					continue;
				}
				const canonicalCapabilities = mergeCanonicalCapabilities(
					command.capabilities,
					previousProjection?.capabilities ?? null
				);
				void session;
				if (previousProjection !== null) {
					this.canonicalProjections.set(sessionId, {
						lifecycle: previousProjection.lifecycle,
						activity: previousProjection.activity,
						turnState: previousProjection.turnState,
						activeTurnFailure: previousProjection.activeTurnFailure,
						lastTerminalTurnId: previousProjection.lastTerminalTurnId,
						capabilities: canonicalCapabilities,
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
				const hotState = this.getHotState(sessionId);
				const updates: SessionTransientProjectionUpdates = {
					capabilityMutationState: {
						pendingMutationId: command.pendingMutationId,
						previewState: command.previewState,
					},
				};
				if (hotState.autonomousTransition !== "idle") {
					updates.autonomousTransition = "idle";
				}
				this.hotStateStore.updateHotState(sessionId, updates);
				continue;
			}

			if (command.kind === "applyTelemetry") {
				const hotState = this.getHotState(sessionId);
				const nextTelemetry = buildCanonicalUsageTelemetry(
					command.telemetry,
					hotState.usageTelemetry,
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
					capabilities: previousProjection.capabilities,
					revision: command.revision,
				});
				const hotState = this.getHotState(sessionId);
				const updates: SessionTransientProjectionUpdates = {};
				if (
					hotState.pendingSendIntent !== null &&
					hotState.pendingSendIntent !== undefined &&
					canonicalProjectionResolvesPendingSendIntent(
						previousProjection.lifecycle,
						command.turnState,
						activeTurnFailure
					)
				) {
					updates.pendingSendIntent = null;
				}
				this.hotStateStore.updateHotState(sessionId, updates);
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
				continue;
			}

			if (command.kind === "refreshSnapshot") {
				logger.warn("Refreshing session-state snapshot for transcript frontier mismatch", {
					sessionId,
					currentRevision: this.entryStore.getTranscriptRevision(sessionId),
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
		const currentTranscriptRevision = this.entryStore.getTranscriptRevision(sessionId);
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

	private refreshSessionStateSnapshot(sessionId: string): InflightSessionStateRefresh {
		const existing = this.inflightSessionStateRefreshes.get(sessionId);
		if (existing) {
			return existing;
		}

		const refresh = api
			.getSessionState(sessionId)
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
	// TOOL CALLS (delegated to messaging service)
	// ============================================

	/**
	 * Get the streaming arguments for a tool call.
	 */
	getStreamingArguments(
		toolCallId: string
	): import("$lib/services/converted-session-types.js").ToolArguments | undefined {
		return this.entryStore.getStreamingArguments(toolCallId);
	}

	/**
	 * Ensure streaming state is set.
	 */
	ensureStreamingState(sessionId: string): void {
		this.messagingSvc.ensureStreamingState(sessionId);
	}

	// ============================================
	// CHUNK AGGREGATION (delegated to messaging service)
	// ============================================

	/**
	 * Aggregate assistant chunk.
	 */
	aggregateAssistantChunk(
		sessionId: string,
		chunk: ContentChunk,
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError> {
		return this.messagingSvc.aggregateAssistantChunk(sessionId, chunk, messageId, isThought);
	}

	aggregateUserChunk(
		sessionId: string,
		chunk: { content: ContentBlock }
	): ResultAsync<void, AppError> {
		return this.entryStore.aggregateUserChunk(sessionId, chunk);
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
