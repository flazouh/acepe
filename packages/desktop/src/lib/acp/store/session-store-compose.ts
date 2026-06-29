/**
 * SessionStore composition root — wires sub-stores and facades (ADR-0002).
 */
import { SvelteMap } from "svelte/reactivity";
import type {
	SessionStateEnvelope,
	SessionStateGraph,
	TranscriptDelta,
	SessionGraphRevision,
} from "../../services/acp-types.js";
import type { CanonicalSessionProjection, RowTokenStream } from "./canonical-session-projection.js";
import { AwaitingModelRefreshStore } from "./awaiting-model-refresh-store.svelte.js";
import { CapabilityProjectionReader } from "./capability-projection-reader.js";
import { ComposerMachineService } from "./composer-machine-service.svelte.js";
import { OperationStore } from "./operation-store.svelte.js";
import { PrLinkStateStore } from "./pr-link-state-store.svelte.js";
import { SessionConnectionFacade } from "./session-connection-facade.js";
import { SessionConnectionService } from "./session-connection-service.svelte.js";
import { SessionCreationCoordinator } from "./session-creation-coordinator.svelte.js";
import { optimisticSessionColdFromPendingCreation } from "./services/optimistic-pending-session.js";
import { SessionEnvelopeApplier } from "./session-envelope-applier.svelte.js";
import { SessionEntryStore } from "./session-entry-store.svelte.js";
import { SessionExportService } from "./session-export-service.js";
import { SessionLifecycleCleanup } from "./session-lifecycle-cleanup.js";
import { SessionListState } from "./session-list-state.svelte.js";
import { SessionLoadingFacade } from "./session-loading-facade.js";
import { SessionMessagingOrchestrator } from "./session-messaging-orchestrator.js";
import { SessionOpenSnapshotApplier } from "./session-open-snapshot-applier.svelte.js";
import { SessionPresentationModel } from "./session-presentation-model.js";
import { SessionProjectionCore } from "./session-projection-core.svelte.js";
import { SessionReadFacade } from "./session-read-facade.js";
import { SessionStateRefreshController } from "./session-state-refresh-controller.svelte.js";
import { SessionTransientProjectionStore } from "./session-transient-projection-store.svelte.js";
import { SessionWriteFacade } from "./session-write-facade.js";
import { SessionConnectionManager } from "./services/session-connection-manager.js";
import { SessionMessagingService } from "./services/session-messaging-service.js";
import { SessionRepository } from "./services/session-repository.js";
import {
	SessionEventService,
	type SessionEventServiceCallbacks,
} from "./session-event-service.svelte.js";
import type { ISessionStateWriter } from "./services/interfaces/index.js";
import type { SessionEventHandler } from "./session-event-handler.js";
import type { SessionStoreCallbacks } from "./session-store.svelte.js";
import { TranscriptRowsController } from "./transcript-rows-controller.svelte.js";
import { SessionIdentityResolver } from "./session-identity-resolver.js";

export type SessionStoreParts = {
	readonly listState: SessionListState;
	readonly projectionCore: SessionProjectionCore;
	readonly transientProjectionStore: SessionTransientProjectionStore;
	readonly operationStore: OperationStore;
	readonly entryStore: SessionEntryStore;
	readonly connectionService: SessionConnectionService;
	readonly composerMachineService: ComposerMachineService;
	readonly capabilityReader: CapabilityProjectionReader;
	readonly exportService: SessionExportService;
	readonly presentation: SessionPresentationModel;
	readonly read: SessionReadFacade;
	readonly write: SessionWriteFacade;
	readonly composer: ComposerMachineService;
	readonly connection: SessionConnectionFacade;
	readonly loading: SessionLoadingFacade;
	readonly viewport: TranscriptRowsController;
	readonly lifecycleCleanup: SessionLifecycleCleanup;
	readonly openSnapshotApplier: SessionOpenSnapshotApplier;
	readonly envelopeApplier: SessionEnvelopeApplier;
	readonly stateRefreshController: SessionStateRefreshController;
	readonly awaitingModelRefresh: AwaitingModelRefreshStore;
	readonly prLinkState: PrLinkStateStore;
	readonly creationCoordinator: SessionCreationCoordinator;
	readonly messagingOrchestrator: SessionMessagingOrchestrator;
	readonly repository: SessionRepository;
	readonly connectionMgr: SessionConnectionManager;
	readonly connectionMgrRef: { current: SessionConnectionManager };
	readonly messagingSvc: SessionMessagingService;
	readonly eventService: SessionEventService;
	readonly onRemoveCallbacks: Array<(sessionId: string) => void>;
	readonly getCanonicalProjection: (sessionId: string) => CanonicalSessionProjection | null;
	readonly getCallbacks: () => SessionStoreCallbacks;
	readonly setCallbacks: (callbacks: SessionStoreCallbacks) => void;
	readonly getCanonicalProjections: () => SvelteMap<string, CanonicalSessionProjection>;
	readonly getSessionStateGraphs: () => SvelteMap<string, SessionStateGraph>;
	readonly getCanonicalCapabilitiesMaterialized: () => SvelteMap<string, boolean>;
	readonly getRowTokenStreamsByRowId: () => Map<string, Map<string, RowTokenStream>>;
	readonly identityResolver: SessionIdentityResolver;
};

export type ComposeSessionStorePartsInput = {
	readonly setLoading: (loading: boolean) => void;
	readonly applySessionStateEnvelope: (sessionId: string, envelope: SessionStateEnvelope) => void;
	readonly updateUsageTelemetry: (
		sessionId: string,
		telemetry: import("./types.js").SessionUsageTelemetry
	) => void;
};

export function composeSessionStoreParts(input: ComposeSessionStorePartsInput): SessionStoreParts {
	const onRemoveCallbacks: Array<(sessionId: string) => void> = [];
	let callbacks: SessionStoreCallbacks = {};

	const listState = new SessionListState();
	const identityResolver = new SessionIdentityResolver({
		hasSession: (sessionId) => listState.hasSession(sessionId),
	});
	const projectionCore = new SessionProjectionCore();
	const transientProjectionStore = new SessionTransientProjectionStore();
	const operationStore = new OperationStore();
	const entryStore = new SessionEntryStore(operationStore);
	const connectionService = new SessionConnectionService();

	const getCanonicalProjection = (sessionId: string): CanonicalSessionProjection | null =>
		projectionCore.canonicalProjections.get(sessionId) ?? null;

	const capabilityReader = new CapabilityProjectionReader({
		getCanonicalProjection,
		getSessionIdentity: (sessionId) => listState.getSessionIdentity(sessionId),
		isCapabilitiesMaterialized: (sessionId) =>
			projectionCore.canonicalCapabilitiesMaterialized.get(sessionId) === true,
		getTransientProjection: (sessionId) => transientProjectionStore.getTransientProjection(sessionId),
	});

	const presentation = new SessionPresentationModel({
		getCanonicalProjection,
		getSessionStateGraph: (sessionId) => projectionCore.getSessionStateGraph(sessionId),
		transientProjectionStore,
		operationStore,
		getSessionCurrentModeId: (sessionId) => capabilityReader.getCurrentModeId(sessionId),
		getSessionConnectionError: (sessionId) => projectionCore.getSessionConnectionError(sessionId),
		getSessionActiveTurnFailure: (sessionId) => projectionCore.getSessionActiveTurnFailure(sessionId),
		getSessionMetadata: (sessionId) => listState.getSessionMetadata(sessionId),
		hasSessionCanonicalProjection: (sessionId) => projectionCore.hasCanonicalProjection(sessionId),
	});

	const composerMachineService = new ComposerMachineService({
		getCommitState: (sessionId) => ({
			modeId: capabilityReader.getCurrentModeId(sessionId),
			modelId: capabilityReader.getCurrentModelId(sessionId),
			autonomousEnabled: capabilityReader.getAutonomousEnabled(sessionId),
		}),
		transientProjectionStore,
		getSessionLifecyclePresentation: (sessionId) =>
			presentation.getSessionLifecyclePresentation(sessionId),
	});

	const exportService = new SessionExportService({
		getSessionStateGraph: (sessionId) => projectionCore.getSessionStateGraph(sessionId),
		getSessionIdentity: (sessionId) => listState.getSessionIdentity(sessionId),
		getSessionMetadata: (sessionId) => listState.getSessionMetadata(sessionId),
	});

	const read = new SessionReadFacade({
		listState,
		projectionCore,
		capabilityReader,
		transientProjectionStore,
		operationStore,
		exportService,
		presentation,
		getCanonicalProjection,
		identityResolver,
	});

	listState.configureReadDeps({
		entryStore,
		hasSessionCanonicalProjection: (sessionId) => read.hasSessionCanonicalProjection(sessionId),
	});

	const viewport = new TranscriptRowsController({
		getGraphRevision: (sessionId) => read.getGraphRevision(sessionId),
		applySessionStateEnvelope: (sessionId, envelope) =>
			input.applySessionStateEnvelope(sessionId, envelope),
	});

	const listWriter: ISessionStateWriter = {
		setSessions: (sessions) => listState.setSessions(sessions),
		setLoading: input.setLoading,
		addSession: (session) => listState.addSession(session),
		updateSession: (id, updates) => listState.updateSession(id, updates),
		removeSession: () => {},
		replaceSessionOpenSnapshot: () => {},
		addScanningProjects: (paths) => listState.addScanningProjects(paths),
		removeScanningProjects: (paths) => listState.removeScanningProjects(paths),
	};

	const eventHandlerRef: { current: SessionEventHandler | null } = { current: null };

	const eventService = new SessionEventService();
	const repository = new SessionRepository(read, listWriter, entryStore, connectionService);
	const messagingSvc = new SessionMessagingService(
		read,
		transientProjectionStore,
		entryStore,
		connectionService
	);

	const creationCoordinator = new SessionCreationCoordinator({
		messagingSvc,
		onTurnError: (sessionId) => callbacks.onTurnError?.(sessionId),
		registerOptimisticSession: (result) => {
			if (listState.hasSession(result.sessionId)) {
				return;
			}
			listState.addSession(optimisticSessionColdFromPendingCreation(result, new Date()));
		},
		// Light list-level removal: the optimistic record was never materialized,
		// so a full lifecycle teardown (DB + model-pref persistence) is both
		// unnecessary and wrong. `repository.removeSession` just filters the list.
		removeOptimisticSession: (sessionId) => repository.removeSession(sessionId),
	});

	const lifecycleCleanup = new SessionLifecycleCleanup({
		repository,
		transientProjectionStore,
		projectionCore,
		viewport,
		messagingSvc,
		composerMachineService,
		entryStore,
		onRemoveCallbacks,
		identityResolver,
	});

	const openSnapshotApplier = new SessionOpenSnapshotApplier({
		listState,
		creationCoordinator,
		getSessionIdentity: (sessionId) => listState.getSessionIdentity(sessionId),
		getSessionMetadata: (sessionId) => listState.getSessionMetadata(sessionId),
		addSession: (session) => listState.addSession(session),
		removeSession: (sessionId) => lifecycleCleanup.removeSession(sessionId),
		removeOptimisticSession: (sessionId) => repository.removeSession(sessionId),
		updateSession: (id, updates, options) => listState.updateSession(id, updates, options),
		replaceSessionOperations: (sessionId, operations) => {
			operationStore.replaceSessionOperations(sessionId, operations);
			maybeAutoLinkPrFromOperations(sessionId);
		},
		replaceTranscriptSnapshot: (sessionId, snapshot, appliedAt) =>
			entryStore.replaceTranscriptSnapshot(sessionId, snapshot, appliedAt),
		initializeTransientProjection: (sessionId) =>
			transientProjectionStore.initializeTransientProjection(sessionId),
		updateTransientProjection: (sessionId, updates) =>
			transientProjectionStore.updateTransientProjection(sessionId, updates),
		setSessionStateGraph: (sessionId, graph) => {
			projectionCore.sessionStateGraphs.set(sessionId, graph);
		},
		setCanonicalProjection: (sessionId, projection) => {
			projectionCore.canonicalProjections.set(sessionId, projection);
		},
		setCapabilitiesMaterialized: (sessionId, materialized) => {
			projectionCore.canonicalCapabilitiesMaterialized.set(sessionId, materialized);
		},
		getCanonicalProjection,
		sendContentLoad: (sessionId) => connectionService.sendContentLoad(sessionId),
		sendContentLoaded: (sessionId) => connectionService.sendContentLoaded(sessionId),
		recordAliasRelationship: (requestedSessionId, canonicalSessionId) =>
			identityResolver.recordAliasRelationship(requestedSessionId, canonicalSessionId),
		migratePendingSendIntentAlias: (requestedSessionId, canonicalSessionId) =>
			messagingSvc.migratePendingSendIntentAlias(requestedSessionId, canonicalSessionId),
	});

	const write = new SessionWriteFacade({
		listState,
		lifecycleCleanup,
		openSnapshotApplier,
		getSessionMetadata: (sessionId) => listState.getSessionMetadata(sessionId),
	});

	const connectionMgrRef: { current: SessionConnectionManager } = { current: null as unknown as SessionConnectionManager };
	const connectionMgr = new SessionConnectionManager(
		read,
		write,
		transientProjectionStore,
		entryStore,
		connectionService,
		eventService
	);
	connectionMgrRef.current = connectionMgr;

	const composer = composerMachineService;

	const messagingOrchestrator = new SessionMessagingOrchestrator({
		messagingSvc,
		creationCoordinator,
		getSessionIdentity: (sessionId) => read.getSessionIdentity(sessionId),
		getSessionMetadata: (sessionId) => read.getSessionMetadata(sessionId),
		getSessionCanSend: (sessionId) => read.getSessionCanSend(sessionId),
		getSessionLifecycleStatus: (sessionId) => read.getSessionLifecycleStatus(sessionId),
		getGraphTranscriptRevision: (sessionId) => read.getGraphTranscriptRevision(sessionId),
		updateSession: (id, updates, options) => write.updateSession(id, updates, options),
	});

	const prLinkState = new PrLinkStateStore({
		getSessionMetadata: (sessionId) => read.getSessionMetadata(sessionId),
		getSessionIdentity: (sessionId) => read.getSessionIdentity(sessionId),
		getSessions: () => listState.sessions,
		getSessionsByProject: (projectPath) => listState.sessionsByProject.get(projectPath),
		updateSession: (id, updates, options) => write.updateSession(id, updates, options),
	});

	// After canonical operations are applied, give PR-link attribution a chance to auto-link
	// the session from a verified `gh pr create` tool call. Reads canonical operation facts;
	// the method is idempotent and no-ops once the session has a linked or manually-set PR.
	const maybeAutoLinkPrFromOperations = (sessionId: string): void => {
		const projectPath = read.getSessionIdentity(sessionId)?.projectPath;
		if (projectPath === undefined) {
			return;
		}
		prLinkState.applyAutomaticPrLinkFromToolOperations(
			sessionId,
			projectPath,
			operationStore.getSessionOperations(sessionId)
		);
	};

	const stateRefreshControllerRef: { current: SessionStateRefreshController | null } = { current: null };
	const awaitingModelRefreshRef: { current: AwaitingModelRefreshStore | null } = { current: null };

	const envelopeApplier = new SessionEnvelopeApplier({
		getCallbacks: () => callbacks,
		getSessionIdentity: (sessionId) => read.getSessionIdentity(sessionId),
		getGraphRevision: (sessionId) => projectionCore.getGraphRevision(sessionId),
		getCanonicalProjection,
		getSessionStateGraph: (sessionId) => projectionCore.getSessionStateGraph(sessionId),
		getCapabilitiesMaterialized: (sessionId) =>
			projectionCore.canonicalCapabilitiesMaterialized.get(sessionId) === true,
		getTransientProjection: (sessionId) => transientProjectionStore.getTransientProjection(sessionId),
		getSessionCurrentModelId: (sessionId) => read.getSessionCurrentModelId(sessionId),
		getSessionCold: (sessionId) => read.getSessionCold(sessionId),
		setCapabilitiesMaterialized: (sessionId, materialized) => {
			projectionCore.canonicalCapabilitiesMaterialized.set(sessionId, materialized);
		},
		setCanonicalProjection: (sessionId, projection) => {
			projectionCore.canonicalProjections.set(sessionId, projection);
		},
		setSessionStateGraph: (sessionId, graph) => {
			projectionCore.sessionStateGraphs.set(sessionId, graph);
		},
		updateTransientProjection: (sessionId, updates) =>
			transientProjectionStore.updateTransientProjection(sessionId, updates),
		updateUsageTelemetry: (sessionId, telemetry) => input.updateUsageTelemetry(sessionId, telemetry),
		applyViewportBufferPush: (push) => viewport.applyBufferPush(push),
		applyViewportBufferDelta: (delta) => viewport.applyBufferDelta(delta),
		replaceSessionOperations: (sessionId, operations) => {
			operationStore.replaceSessionOperations(sessionId, operations);
			maybeAutoLinkPrFromOperations(sessionId);
		},
		replaceTranscriptSnapshot: (sessionId, snapshot, appliedAt) =>
			entryStore.replaceTranscriptSnapshot(sessionId, snapshot, appliedAt),
		applyTranscriptDeltaToEntryStore: (sessionId, delta, appliedAt) =>
			entryStore.applyTranscriptDelta(sessionId, delta, appliedAt),
		applySessionOperationPatches: (sessionId, patches) => {
			operationStore.applySessionOperationPatches(sessionId, patches);
			maybeAutoLinkPrFromOperations(sessionId);
		},
		replaceLiveSessionStateGraph: (graph) => creationCoordinator.replaceLiveSessionStateGraph(graph),
		applyLiveSessionInteractionPatches: (snapshots) =>
			creationCoordinator.applyLiveSessionInteractionPatches(snapshots),
		syncAwaitingModelRefreshTimer: (sessionId, activity, turnState) => {
			awaitingModelRefreshRef.current?.syncAwaitingModelRefreshTimer(sessionId, activity, turnState);
		},
		reconcileConnectionMachine: (sessionId, lifecycle, turnState, activeTurnFailure) => {
			connectionService.syncFromCanonicalState(sessionId, lifecycle, turnState, activeTurnFailure);
		},
		syncSessionSequenceFromGraph: (graph) => openSnapshotApplier.syncSessionSequenceFromGraph(graph),
		composerEndDispatch: (sessionId) => composerMachineService.endDispatch(sessionId),
		handleCanonicalTurnComplete: (sessionId, lastTerminalTurnId) => {
			messagingSvc.handleCanonicalTurnComplete(sessionId, lastTerminalTurnId);
		},
		handleCanonicalTurnFailure: (sessionId, error) => {
			messagingSvc.handleCanonicalTurnFailure(sessionId, error);
		},
		refreshSessionStateSnapshot: (sessionId) => {
			const controller = stateRefreshControllerRef.current;
			if (controller === null) {
				throw new Error("SessionStateRefreshController not initialized");
			}
			return controller.refreshSessionStateSnapshot(sessionId);
		},
		rowTokenStreamsByRowId: projectionCore.rowTokenStreamsByRowId,
	});

	const stateRefreshController = new SessionStateRefreshController({
		applySessionStateEnvelope: (sessionId, envelope) =>
			envelopeApplier.applySessionStateEnvelope(sessionId, envelope),
	});
	stateRefreshControllerRef.current = stateRefreshController;

	const awaitingModelRefresh = new AwaitingModelRefreshStore({
		refreshSessionStateSnapshot: (sessionId) =>
			stateRefreshController.refreshSessionStateSnapshot(sessionId),
		getCanonicalProjection,
	});
	awaitingModelRefreshRef.current = awaitingModelRefresh;

	eventHandlerRef.current = {
		getSessionCold: (sessionId) => read.getSessionCold(sessionId),
		getSessionIdentity: (sessionId) => read.getSessionIdentity(sessionId),
		getSessionCanSend: (sessionId) => read.getSessionCanSend(sessionId),
		hasPendingCreationSession: (sessionId) => creationCoordinator.hasPendingCreation(sessionId),
		materializePendingCreationSession: (sessionId) => {
			if (read.getSessionIdentity(sessionId)) {
				const pendingCreation = creationCoordinator.getPendingCreation(sessionId);
				if (pendingCreation !== null && pendingCreation.sequenceId != null) {
					const metadata = read.getSessionMetadata(sessionId);
					if (metadata?.sequenceId == null) {
						listState.updateSession(
							sessionId,
							{ sequenceId: pendingCreation.sequenceId },
							{ touchUpdatedAt: false }
						);
					}
				}
				if (pendingCreation !== null) {
					creationCoordinator.completePendingCreation(sessionId);
				}
				return true;
			}
			const pendingCreation = creationCoordinator.getPendingCreation(sessionId);
			if (pendingCreation === null) {
				return false;
			}
			const now = new Date();
			listState.addSession({
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
			creationCoordinator.completePendingCreation(sessionId);
			return true;
		},
		failPendingCreationSession: (sessionId, update) => {
			creationCoordinator.failPendingCreationSession(sessionId, update);
		},
		ensureSessionFromStateGraph: (graph) => openSnapshotApplier.ensureSessionFromStateGraph(graph),
		updateUsageTelemetry: input.updateUsageTelemetry,
		applySessionStateEnvelope: (sessionId, envelope) =>
			envelopeApplier.applySessionStateEnvelope(sessionId, envelope),
	};

	const connection = new SessionConnectionFacade({
		connectionMgrRef,
		messagingSvc,
		messagingOrchestrator,
		creationCoordinator,
		listState,
		awaitingModelRefresh,
		prLinkState,
		read,
		write,
		eventHandler: eventHandlerRef.current,
		getCallbacks: () => callbacks,
	});

	const loading = new SessionLoadingFacade({
		repository,
		listState,
		connectionService,
		prLinkState,
		read,
		write,
		setLoading: input.setLoading,
	});

	const setCallbacks = (nextCallbacks: SessionStoreCallbacks): void => {
		callbacks = nextCallbacks;
		const eventCallbacks: SessionEventServiceCallbacks = {
			onPlanUpdate: nextCallbacks.onPlanUpdate,
			onTurnComplete: nextCallbacks.onTurnComplete,
		};
		eventService.setCallbacks(eventCallbacks);
	};

	return {
		listState,
		projectionCore,
		transientProjectionStore,
		operationStore,
		entryStore,
		connectionService,
		composerMachineService,
		capabilityReader,
		exportService,
		presentation,
		read,
		write,
		composer,
		connection,
		loading,
		viewport,
		lifecycleCleanup,
		openSnapshotApplier,
		envelopeApplier,
		stateRefreshController,
		awaitingModelRefresh,
		prLinkState,
		creationCoordinator,
		messagingOrchestrator,
		repository,
		connectionMgr,
		connectionMgrRef,
		messagingSvc,
		eventService,
		onRemoveCallbacks,
		getCanonicalProjection,
		getCallbacks: () => callbacks,
		setCallbacks,
		getCanonicalProjections: () => projectionCore.canonicalProjections,
		getSessionStateGraphs: () => projectionCore.sessionStateGraphs,
		getCanonicalCapabilitiesMaterialized: () => projectionCore.canonicalCapabilitiesMaterialized,
		getRowTokenStreamsByRowId: () => projectionCore.rowTokenStreamsByRowId,
		identityResolver,
	};
}
