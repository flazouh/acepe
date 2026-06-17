/**
 * SessionConnectionFacade — connect/disconnect/messaging/PR surface (ADR-0002).
 */
import { okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "../errors/app-error.js";
import type { Attachment } from "../components/agent-input/types/attachment.js";
import type { GitStackedPrStep, PrChecks, PrDetails } from "../../utils/tauri-client/git.js";
import type { AwaitingModelRefreshStore } from "./awaiting-model-refresh-store.svelte.js";
import type {
	CreatedSessionHydrator,
	LiveSessionStateGraphConsumer,
	SessionCreationResult,
} from "./session-store.svelte.js";
import type { SessionCreationCoordinator } from "./session-creation-coordinator.svelte.js";
import type { SessionListState } from "./session-list-state.svelte.js";
import type { SessionMessagingOrchestrator } from "./session-messaging-orchestrator.js";
import type { SessionStoreCallbacks } from "./session-store.svelte.js";
import type { ViewportProjectionController } from "./viewport-projection-controller.svelte.js";
import type { PrLinkStateStore } from "./pr-link-state-store.svelte.js";
import type { SessionConnectionManager } from "./services/session-connection-manager.js";
import type { SessionMessagingService } from "./services/session-messaging-service.js";
import type { SessionCold, SessionPrLinkMode } from "./types.js";
import type { SessionEventHandler } from "./session-event-handler.js";
import type { SessionReadFacade } from "./session-read-facade.js";
import type { SessionWriteFacade } from "./session-write-facade.js";

export type SessionConnectionFacadeDeps = {
	readonly connectionMgrRef: { current: SessionConnectionManager };
	readonly messagingSvc: SessionMessagingService;
	readonly messagingOrchestrator: SessionMessagingOrchestrator;
	readonly creationCoordinator: SessionCreationCoordinator;
	readonly listState: SessionListState;
	readonly viewport: ViewportProjectionController;
	readonly awaitingModelRefresh: AwaitingModelRefreshStore;
	readonly prLinkState: PrLinkStateStore;
	readonly read: SessionReadFacade;
	readonly write: SessionWriteFacade;
	readonly eventHandler: SessionEventHandler;
	readonly getCallbacks: () => SessionStoreCallbacks;
};

export class SessionConnectionFacade {
	readonly #deps: SessionConnectionFacadeDeps;

	constructor(deps: SessionConnectionFacadeDeps) {
		this.#deps = deps;
	}

	hasPendingCreationSession(sessionId: string): boolean {
		return this.#deps.creationCoordinator.hasPendingCreation(sessionId);
	}

	materializePendingCreationSession(sessionId: string): boolean {
		const pendingCreation = this.#deps.creationCoordinator.getPendingCreation(sessionId);

		if (this.#deps.read.getSessionIdentity(sessionId)) {
			if (pendingCreation !== null && pendingCreation.sequenceId != null) {
				const metadata = this.#deps.read.getSessionMetadata(sessionId);
				if (metadata?.sequenceId == null) {
					this.#deps.write.updateSession(
						sessionId,
						{ sequenceId: pendingCreation.sequenceId },
						{ touchUpdatedAt: false }
					);
				}
			}
			if (pendingCreation !== null) {
				this.#deps.creationCoordinator.completePendingCreation(sessionId);
			}
			return true;
		}

		if (pendingCreation === null) {
			return false;
		}

		const now = new Date();
		this.#deps.write.addSession({
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
			sequenceId: pendingCreation.sequenceId ?? undefined,
		});
		this.#deps.creationCoordinator.completePendingCreation(sessionId);
		return true;
	}

	failPendingCreationSession(
		sessionId: string,
		update: import("../types/turn-error.js").TurnErrorUpdate
	): void {
		this.#deps.creationCoordinator.failPendingCreationSession(sessionId, update);
	}

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
		return this.#deps.connectionMgrRef.current.createSession(options, this.#deps.eventHandler).andThen((createdSession) => {
			if (createdSession.kind === "pending") {
				this.#deps.creationCoordinator.beginPendingCreation(createdSession.sessionId, createdSession);
				return okAsync(createdSession);
			}

			if (
				this.#deps.creationCoordinator.hasSessionOpenHydrator() &&
				createdSession.sessionOpen?.outcome === "found"
			) {
				return this.#deps.creationCoordinator.hydrateCreatedSession(createdSession.sessionOpen).map(() => ({
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
		this.#deps.creationCoordinator.attachSessionConsumers({ sessionOpenHydrator: hydrator });
	}

	setLiveSessionStateGraphConsumer(consumer: LiveSessionStateGraphConsumer): void {
		this.#deps.creationCoordinator.attachSessionConsumers({ liveSessionStateGraphConsumer: consumer });
	}

	connectSession(
		sessionId: string,
		options?: { openToken?: string; forceReconnect?: boolean }
	): ResultAsync<SessionCold, AppError> {
		return this.#deps.connectionMgrRef.current.connectSession(sessionId, this.#deps.eventHandler, options);
	}

	disconnectSession(sessionId: string): void {
		this.#deps.connectionMgrRef.current.disconnectSession(sessionId);
		this.#deps.messagingSvc.clearSessionState(sessionId);
		this.#deps.awaitingModelRefresh.clearAwaitingModelRefreshTimer(sessionId);
		this.#deps.viewport.clearReattachWatchdog(sessionId);
	}

	disconnectAllSessions(): void {
		const connectedSessions = this.#deps.listState.sessions.filter(
			(s) => this.#deps.read.getSessionCanSend(s.id) === true
		);
		for (const session of connectedSessions) {
			this.disconnectSession(session.id);
		}
		this.#deps.awaitingModelRefresh.clearAllAwaitingModelRefreshTimers();
	}

	setModel(sessionId: string, modelId: string): ResultAsync<void, AppError> {
		return this.#deps.connectionMgrRef.current.setModel(sessionId, modelId);
	}

	setMode(sessionId: string, modeId: string): ResultAsync<void, AppError> {
		return this.#deps.connectionMgrRef.current.setMode(sessionId, modeId);
	}

	setAutonomousEnabled(sessionId: string, enabled: boolean): ResultAsync<void, AppError> {
		return this.#deps.connectionMgrRef.current.setAutonomousEnabled(sessionId, enabled, this.#deps.eventHandler);
	}

	setConfigOption(sessionId: string, configId: string, value: string): ResultAsync<void, AppError> {
		return this.#deps.connectionMgrRef.current.setConfigOption(sessionId, configId, value);
	}

	cancelStreaming(sessionId: string): ResultAsync<void, AppError> {
		return this.#deps.connectionMgrRef.current.cancelStreaming(sessionId).map(() => {
			this.#deps.getCallbacks().onTurnInterrupted?.(sessionId);
			return undefined;
		});
	}

	sendMessage(
		sessionId: string,
		content: string,
		attachments: readonly Attachment[] = []
	): ResultAsync<void, AppError> {
		return this.#deps.messagingOrchestrator.sendMessage(sessionId, content, attachments);
	}

	updateSessionPrLink(
		sessionId: string,
		projectPath: string,
		prNumber: number | null,
		prLinkMode: SessionPrLinkMode
	): ResultAsync<void, AppError> {
		return this.#deps.prLinkState.updateSessionPrLink(sessionId, projectPath, prNumber, prLinkMode);
	}

	restoreAutomaticSessionPrLink(sessionId: string, projectPath: string): ResultAsync<void, AppError> {
		return this.#deps.prLinkState.restoreAutomaticSessionPrLink(sessionId, projectPath);
	}

	applyAutomaticPrLinkFromShipWorkflow(
		sessionId: string,
		projectPath: string,
		pr: GitStackedPrStep
	): ResultAsync<number | null, never> {
		return this.#deps.prLinkState.applyAutomaticPrLinkFromShipWorkflow(sessionId, projectPath, pr);
	}

	invalidatePrDetails(projectPath: string, prNumber: number): void {
		this.#deps.prLinkState.invalidatePrDetails(projectPath, prNumber);
	}

	invalidatePrChecks(projectPath: string, prNumber: number): void {
		this.#deps.prLinkState.invalidatePrChecks(projectPath, prNumber);
	}

	registerVisiblePrChecksSurface(
		projectPath: string,
		prNumber: number,
		surfaceId: string
	): () => void {
		return this.#deps.prLinkState.registerVisiblePrChecksSurface(projectPath, prNumber, surfaceId);
	}

	refreshSessionPrChecks(
		sessionId: string,
		projectPath: string,
		prNumber: number,
		options?: { force?: boolean }
	): ResultAsync<PrChecks | null, never> {
		return this.#deps.prLinkState.refreshSessionPrChecks(sessionId, projectPath, prNumber, options);
	}

	refreshSessionPrState(
		sessionId: string,
		projectPath: string,
		prNumber: number
	): ResultAsync<PrDetails | null, never> {
		return this.#deps.prLinkState.refreshSessionPrState(sessionId, projectPath, prNumber);
	}

	refreshAllPrStates(): void {
		this.#deps.prLinkState.refreshAllPrStates();
	}
}
