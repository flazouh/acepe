/**
 * SessionReadFacade — namespaced read surface for the session store (ADR-0002).
 */

import type { Result } from "neverthrow";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type {
	ConfigOptionData as CanonicalConfigOptionData,
	FailureReason,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionTurnState,
	TranscriptEntry,
} from "../../services/acp-types.js";
import type { SessionPrLinkReference } from "../application/dto/session-linked-pr.js";
import {
	deriveSessionListStateFromCanonical,
	type SessionListState,
} from "../application/dto/session-summary.js";
import type { AgentPanelCanonicalSource } from "../session-state/agent-panel-canonical-source.js";
import type { AvailableCommand } from "../types/available-command.js";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import type { PermissionRequest } from "../types/permission.js";
import type { ToolCall } from "../types/tool-call.js";
import type { ToolKind } from "../types/tool-kind.js";
import type { ActiveTurnFailure } from "../types/turn-error.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import type { CapabilityProjectionReader } from "./capability-projection-reader.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import type { SessionOperationInteractionSnapshot } from "./operation-association.js";
import type { OperationStore } from "./operation-store.svelte.js";
import type { ISessionStateReader } from "./services/interfaces/index.js";
import type { SessionLiveSyncReference, SessionPaletteReference } from "./session-cold-index.js";
import type { SessionExportService } from "./session-export-service.js";
import type { SessionExportContentError } from "./session-graph-builders.js";
import type { SessionIdentityResolver } from "./session-identity-resolver.js";
import type { SessionListState as SessionListStateStore } from "./session-list-state.svelte.js";
import type { SessionPresentationModel } from "./session-presentation-model.js";
import type { SessionProjectionCore } from "./session-projection-core.svelte.js";
import type { SessionTransientProjectionStore } from "./session-transient-projection-store.svelte.js";
import type {
	Mode,
	Model,
	SessionCapabilities,
	SessionCold,
	SessionIdentity,
	SessionMetadata,
	SessionPendingSendIntent,
	SessionUsageTelemetry,
} from "./types.js";

export type SessionReadFacadeDeps = {
	readonly listState: SessionListStateStore;
	readonly projectionCore: SessionProjectionCore;
	readonly capabilityReader: CapabilityProjectionReader;
	readonly transientProjectionStore: SessionTransientProjectionStore;
	readonly operationStore: OperationStore;
	readonly exportService: SessionExportService;
	readonly presentation: SessionPresentationModel;
	readonly getCanonicalProjection: (sessionId: string) => CanonicalSessionProjection | null;
	readonly identityResolver: SessionIdentityResolver;
};

export class SessionReadFacade implements ISessionStateReader {
	readonly #deps: SessionReadFacadeDeps;

	constructor(deps: SessionReadFacadeDeps) {
		this.#deps = deps;
	}

	getAllSessions(): SessionCold[] {
		return this.#deps.listState.getAllSessions();
	}

	getSessionIdentity(id: string): SessionIdentity | undefined {
		return this.#deps.listState.getSessionIdentity(id);
	}

	getSessionMetadata(id: string): SessionMetadata | undefined {
		return this.#deps.listState.getSessionMetadata(id);
	}

	getSessionCold(id: string): SessionCold | undefined {
		return this.#deps.listState.getSessionCold(id);
	}

	hasSession(sessionId: string): boolean {
		return this.#deps.listState.hasSession(sessionId);
	}

	getSessionIdsForProject(projectPath: string): string[] {
		return this.#deps.listState.getSessionIdsForProject(projectPath);
	}

	getLiveSessionSyncReferences(): SessionLiveSyncReference[] {
		return this.#deps.listState.getLiveSessionSyncReferences();
	}

	getSessionPaletteReferences(): SessionPaletteReference[] {
		return this.#deps.listState.getSessionPaletteReferences();
	}

	getSessionPaletteReference(sessionId: string): SessionPaletteReference | undefined {
		return this.#deps.listState.getSessionPaletteReference(sessionId);
	}

	getSessionPrLinkReferencesForProject(projectPath: string): SessionPrLinkReference[] {
		return this.#deps.listState.getSessionPrLinkReferencesForProject(projectPath);
	}

	getSessionDetail(sessionId: string): SessionCold | null {
		return this.#deps.listState.getSessionDetail(sessionId);
	}

	getSessionListState(sessionId: string): SessionListState {
		return deriveSessionListStateFromCanonical(this.#deps.getCanonicalProjection(sessionId));
	}

	hasSessionCanonicalProjection(sessionId: string): boolean {
		return this.#deps.projectionCore.hasCanonicalProjection(sessionId);
	}

	getSessionMessageCount(sessionId: string): number | null {
		return this.#deps.projectionCore.getMessageCount(sessionId);
	}

	getSessionTranscriptEntries(sessionId: string): ReadonlyArray<TranscriptEntry> | null {
		return this.#deps.projectionCore.getTranscriptEntries(sessionId);
	}

	getSessionCanSend(sessionId: string): boolean | null {
		return this.#deps.projectionCore.getCanSend(sessionId);
	}

	getSessionLifecycleStatus(sessionId: string): SessionGraphLifecycle["status"] | null {
		return this.#deps.projectionCore.getLifecycleStatus(sessionId);
	}

	getSessionLifecycle(sessionId: string): SessionGraphLifecycle | null {
		return this.#deps.projectionCore.getLifecycle(sessionId);
	}

	getSessionActivity(sessionId: string): SessionGraphActivity | null {
		return this.#deps.projectionCore.getActivity(sessionId);
	}

	getSessionGraphRevision(sessionId: string): SessionGraphRevision | null {
		return this.#deps.projectionCore.getGraphRevisionOrNull(sessionId);
	}

	getSessionTurnState(sessionId: string): SessionTurnState | null {
		return this.#deps.projectionCore.getTurnState(sessionId);
	}

	getSessionConnectionError(sessionId: string): string | null {
		return this.#deps.projectionCore.getSessionConnectionError(sessionId);
	}

	getSessionLifecycleFailureReason(sessionId: string): FailureReason | null {
		return this.#deps.projectionCore.getSessionLifecycleFailureReason(sessionId);
	}

	getSessionLifecycleDetachedReason(
		sessionId: string
	): import("$lib/services/acp-types.js").DetachedReason | null {
		return this.#deps.projectionCore.getSessionLifecycleDetachedReason(sessionId);
	}

	getSessionActiveTurnFailure(sessionId: string): ActiveTurnFailure | null {
		return this.#deps.projectionCore.getSessionActiveTurnFailure(sessionId);
	}

	getSessionLastTerminalTurnId(sessionId: string): string | null {
		return this.#deps.projectionCore.getLastTerminalTurnId(sessionId);
	}

	getGraphTranscriptRevision(sessionId: string): number | undefined {
		return this.#deps.projectionCore.getGraphTranscriptRevision(sessionId);
	}

	getGraphRevision(sessionId: string): SessionGraphRevision | undefined {
		return this.#deps.projectionCore.getGraphRevision(sessionId);
	}

	hasSessionCanonicalCapabilities(sessionId: string): boolean {
		return this.#deps.capabilityReader.hasCanonicalCapabilities(sessionId);
	}

	getSessionAutonomousEnabled(sessionId: string): boolean | null {
		return this.#deps.capabilityReader.getAutonomousEnabled(sessionId);
	}

	getSessionCurrentModeId(sessionId: string): string | null {
		return this.#deps.capabilityReader.getCurrentModeId(sessionId);
	}

	getSessionCurrentModelId(sessionId: string): string | null {
		return this.#deps.capabilityReader.getCurrentModelId(sessionId);
	}

	getSessionAvailableCommands(sessionId: string): ReadonlyArray<AvailableCommand> | null {
		return this.#deps.capabilityReader.getAvailableCommands(sessionId);
	}

	getSessionConfigOptions(sessionId: string): ReadonlyArray<CanonicalConfigOptionData> | null {
		return this.#deps.capabilityReader.getConfigOptions(sessionId);
	}

	getSessionAvailableModels(sessionId: string): ReadonlyArray<Model> | null {
		return this.#deps.capabilityReader.getAvailableModels(sessionId);
	}

	getSessionAvailableModes(sessionId: string): ReadonlyArray<Mode> | null {
		return this.#deps.capabilityReader.getAvailableModes(sessionId);
	}

	getSessionModelsDisplay(sessionId: string): ModelsForDisplay | null {
		return this.#deps.capabilityReader.getModelsDisplay(sessionId);
	}

	getSessionProviderMetadata(sessionId: string): ProviderMetadataProjection | null {
		return this.#deps.capabilityReader.getProviderMetadata(sessionId);
	}

	getSessionCapabilityRevision(sessionId: string): SessionGraphRevision | null {
		return this.#deps.capabilityReader.getCapabilityRevision(sessionId);
	}

	getSessionCapabilityPendingMutationId(sessionId: string): string | null {
		return this.#deps.capabilityReader.getPendingMutationId(sessionId);
	}

	getSessionCapabilityPreviewState(sessionId: string): SessionCapabilities["previewState"] | null {
		return this.#deps.capabilityReader.getPreviewState(sessionId);
	}

	getSessionPendingSendIntent(sessionId: string): SessionPendingSendIntent | null {
		return this.#deps.transientProjectionStore.getSessionPendingSendIntent(sessionId);
	}

	getSessionHasLocalPendingSendIntent(sessionId: string): boolean {
		return this.#deps.transientProjectionStore.getSessionHasLocalPendingSendIntent(sessionId);
	}

	getSessionAcpSessionId(sessionId: string): string | null {
		return this.#deps.transientProjectionStore.getSessionAcpSessionId(sessionId);
	}

	getSessionUsageTelemetry(sessionId: string): SessionUsageTelemetry | null {
		return this.#deps.transientProjectionStore.getSessionUsageTelemetry(sessionId);
	}

	getSessionAutonomousTransitionBusy(sessionId: string): boolean {
		return this.#deps.transientProjectionStore.getSessionAutonomousTransitionBusy(sessionId);
	}

	getSessionStatusChangedAt(sessionId: string): number {
		return this.#deps.transientProjectionStore.getSessionStatusChangedAt(sessionId);
	}

	getSessionToolCalls(sessionId: string): ToolCall[] {
		return this.#deps.operationStore.getSessionToolCalls(sessionId);
	}

	getSessionCurrentStreamingToolCall(sessionId: string): ToolCall | null {
		return this.#deps.operationStore.getCurrentStreamingToolCall(sessionId);
	}

	getSessionLastToolCall(sessionId: string): ToolCall | null {
		return this.#deps.operationStore.getLastToolCall(sessionId);
	}

	getSessionLastTodoToolCall(sessionId: string): ToolCall | null {
		return this.#deps.operationStore.getLastTodoToolCall(sessionId);
	}

	getSessionModifiedFilesState(sessionId: string): ModifiedFilesState | null {
		return this.#deps.operationStore.getSessionModifiedFilesState(sessionId);
	}

	getToolCallById(sessionId: string, toolCallId: string): ToolCall | null {
		return this.#deps.operationStore.getToolCallById(sessionId, toolCallId);
	}

	isToolCallExecuting(sessionId: string, toolCallId: string): boolean {
		return this.#deps.operationStore.isToolCallExecuting(sessionId, toolCallId);
	}

	getSessionCurrentToolKind(sessionId: string): ToolKind | null {
		return this.#deps.operationStore.getCurrentToolKind(sessionId);
	}

	isPermissionRepresentedByToolCall(permission: PermissionRequest, sessionId: string): boolean {
		return this.#deps.operationStore.isPermissionRepresentedByToolCall(permission, sessionId);
	}

	getVisiblePermissionsForSessionBar(
		permissions: ReadonlyArray<PermissionRequest>
	): PermissionRequest[] {
		return this.#deps.operationStore.getVisiblePermissionsForSessionBar(permissions);
	}

	getSessionMarkdownExportContent(sessionId: string): Result<string, SessionExportContentError> {
		return this.#deps.exportService.getMarkdownExportContent(sessionId);
	}

	getSessionJsonExportContent(sessionId: string): Result<string, SessionExportContentError> {
		return this.#deps.exportService.getJsonExportContent(sessionId);
	}

	getSessionAgentPanelCanonicalSource(sessionId: string): AgentPanelCanonicalSource | null {
		return this.#deps.presentation.getSessionAgentPanelCanonicalSource(sessionId);
	}

	resolveCanonicalSessionId(requestedId: string): string | null {
		return this.#deps.identityResolver.resolveCanonicalSessionId(requestedId);
	}

	getSessionOperationInteractionSnapshot(
		sessionId: string,
		interactions: InteractionStore
	): SessionOperationInteractionSnapshot {
		return this.#deps.presentation.getSessionOperationInteractionSnapshot(sessionId, interactions);
	}
}
