/**
 * Session Connection Manager - Handles session connection lifecycle.
 *
 * Responsibilities:
 * - Session creation (new sessions)
 * - Session connection (resume existing sessions)
 * - Session disconnection
 * - Model/mode/config switching via canonical capability envelopes
 *
 * This service is extracted from SessionStore to separate concerns
 * and reduce the God class anti-pattern.
 */

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../../services/acp-provider-metadata.js";
import type {
	SessionModelState as AcpSessionModelState,
	SessionOpenResult,
} from "../../../services/acp-types.js";
import { TauriCommandError } from "../../../utils/tauri-client/invoke.js";
import { tauriClient } from "../../../utils/tauri-client.js";
import type { AppError } from "../../errors/app-error.js";
import {
	AgentError,
	AuthenticationRequiredError,
	ConnectionError,
	CreationFailureError,
	SessionNotFoundError,
} from "../../errors/app-error.js";
import { sessionColdFromSlices } from "../../application/dto/session-cold.js";
import { createLogger } from "../../utils/logger.js";
import { extractProjectName } from "../../utils/path-utils.js";
import { generateFallbackProjectColor } from "../../utils/project-utils.js";
import * as preferencesStore from "../agent-model-preferences-store.svelte.js";
import { api, type SessionConnectionReadiness } from "../api.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import type {
	ConnectionCompleteData,
	SessionEventService,
} from "../session-event-service.svelte.js";
import type { Mode, Model, SessionCold } from "../types.js";
import type {
	IConnectionManager,
	IEntryManager,
	ISessionStateReader,
	ISessionStateWriter,
	ITransientProjectionManager,
} from "./interfaces/index.js";

const logger = createLogger({ id: "session-connection-manager", name: "SessionConnectionManager" });

/**
 * Watchdog timeout (ms) — pure defense-in-depth.
 * The authoritative timeout lives in Rust (45s). This watchdog fires only
 * if the Rust task panics or the SSE bridge drops the lifecycle event.
 */
export const SESSION_CONNECTION_WATCHDOG_TIMEOUT_MS = 90_000;
export const SESSION_CONNECTION_READINESS_RECONCILE_TIMEOUT_MS =
	SESSION_CONNECTION_WATCHDOG_TIMEOUT_MS;
const WATCHDOG_TIMEOUT_MS = SESSION_CONNECTION_WATCHDOG_TIMEOUT_MS;
const READINESS_RECONCILE_TIMEOUT_MS = SESSION_CONNECTION_READINESS_RECONCILE_TIMEOUT_MS;
const READINESS_RECONCILE_INTERVAL_MS = 500;

/** Global attempt counter for stale-event detection. */
let nextAttemptId = 1;

interface ConnectSessionOptions {
	agentOverrideId?: string;
	openToken?: string;
	/**
	 * Bypass the "already connected" short-circuit. Used only by viewport
	 * recovery: after a backend runtime reload the stale canonical lifecycle
	 * still reports "connected", so a normal reconnect no-ops and never
	 * re-pushes the visible-window envelope. Forcing the reconnect makes Rust
	 * re-emit connection-complete (and the visible-window envelope) via the
	 * live event stream, re-attaching the viewport.
	 */
	forceReconnect?: boolean;
}

export interface CreatedReadySessionResult {
	readonly kind: "ready";
	readonly session: SessionCold;
	readonly sessionOpen: SessionOpenResult | null;
}

export interface CreatedPendingSessionResult {
	readonly kind: "pending";
	readonly sessionId: string;
	readonly creationAttemptId: string | null;
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
	readonly managed: true;
	readonly sequenceId: number | null;
	readonly agentId: string;
	readonly title: string | null;
	readonly worktreePath: string | null;
}

export type CreatedSessionResult = CreatedReadySessionResult | CreatedPendingSessionResult;

type ProviderAwareSessionModelState = AcpSessionModelState & {
	readonly providerMetadata?: ProviderMetadataProjection | null;
	readonly modelsDisplay?: ModelsForDisplay | null;
};

type ConnectionMaterializationOutcome =
	| { readonly kind: "ok"; readonly data: ConnectionCompleteData }
	| { readonly kind: "error"; readonly error: AppError };

function getProviderAwareSessionModelState(
	modelState: AcpSessionModelState | null | undefined
): ProviderAwareSessionModelState {
	if (!modelState) {
		return {};
	}

	return modelState as ProviderAwareSessionModelState;
}

function canSendFromCanonical(reader: ISessionStateReader, sessionId: string): boolean {
	return reader.getSessionCanSend(sessionId) === true;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function closeCreatedSessionAfterSelectionFailure<T>(
	sessionId: string,
	selectionError: AppError
): ResultAsync<T, AppError> {
	return api
		.closeSession(sessionId)
		.mapErr((cleanupError) => {
			const selectionMessage = selectionError.cause?.message ?? selectionError.message;
			const cleanupMessage = cleanupError.cause?.message ?? cleanupError.message;
			return new AgentError(
				`createSession; initial model or mode selection failed (${selectionMessage}); closing the created session also failed (${cleanupMessage})`,
				cleanupError
			);
		})
		.andThen(() => errAsync<T, AppError>(selectionError));
}

function readyConnectionDataFromReadiness(
	readiness: SessionConnectionReadiness
): ConnectionCompleteData | null {
	if (readiness.lifecycle.status !== "ready") {
		return null;
	}

	const capabilities = readiness.capabilities;
	if (!capabilities.models || !capabilities.modes) {
		return null;
	}

	return {
		models: capabilities.models,
		modes: capabilities.modes,
		availableCommands: capabilities.availableCommands ?? null,
		configOptions: capabilities.configOptions ?? null,
		autonomousEnabled: capabilities.autonomousEnabled ?? null,
	};
}

async function reconcileReadyConnection(
	sessionId: string,
	eventHandler: SessionEventHandler,
	isCancelled: () => boolean
): Promise<ConnectionCompleteData> {
	const deadlineMs = Date.now() + READINESS_RECONCILE_TIMEOUT_MS;
	await delay(READINESS_RECONCILE_INTERVAL_MS);

	while (Date.now() <= deadlineMs && !isCancelled()) {
		const materialized = await api.fetchSessionConnectionReadiness(sessionId).match(
			(readiness) => readyConnectionDataFromReadiness(readiness),
			() => null
		);

		if (materialized !== null) {
			const applied = await api.fetchCanonicalSessionStateEnvelope(sessionId).match(
				(envelope) => {
					eventHandler.applySessionStateEnvelope(sessionId, envelope);
					return true;
				},
				() => false
			);

			if (applied) {
				return materialized;
			}
		}

		await delay(READINESS_RECONCILE_INTERVAL_MS);
	}

	if (isCancelled()) {
		throw new Error("Canonical readiness reconciliation was cancelled.");
	}

	throw new Error("Canonical session connection did not become ready after reconnect.");
}

function createReadyConnectionReconciler(
	sessionId: string,
	eventHandler: SessionEventHandler
): { promise: Promise<ConnectionCompleteData>; cancel: () => void } {
	let cancelled = false;
	return {
		promise: reconcileReadyConnection(sessionId, eventHandler, () => cancelled),
		cancel: () => {
			cancelled = true;
		},
	};
}

function canonicalCurrentModeId(reader: ISessionStateReader, sessionId: string): string | null {
	return reader.getSessionCurrentModeId(sessionId);
}

function canonicalAutonomousEnabled(reader: ISessionStateReader, sessionId: string): boolean | null {
	return reader.getSessionAutonomousEnabled(sessionId);
}

function canonicalAvailableModels(
	reader: ISessionStateReader,
	sessionId: string
): ReadonlyArray<Model> | null {
	return reader.getSessionAvailableModels(sessionId);
}

function canonicalAvailableModes(
	reader: ISessionStateReader,
	sessionId: string
): ReadonlyArray<Mode> | null {
	return reader.getSessionAvailableModes(sessionId);
}

function canonicalWireOpen(reader: ISessionStateReader, sessionId: string): boolean {
	const lifecycleStatus = reader.getSessionLifecycleStatus(sessionId);
	return (
		lifecycleStatus === "ready" ||
		lifecycleStatus === "activating" ||
		lifecycleStatus === "reconnecting"
	);
}

/**
 * Manager for session connection lifecycle operations.
 */
export class SessionConnectionManager {
	// Cache in-flight connection ResultAsync per session.
	// Concurrent callers get the same Promise — no duplicate API calls.
	private pendingConnections = new Map<string, ResultAsync<SessionCold, AppError>>();

	constructor(
		private readonly stateReader: ISessionStateReader,
		private readonly stateWriter: ISessionStateWriter,
		private readonly transientProjectionManager: ITransientProjectionManager,
		private readonly entryManager: IEntryManager,
		private readonly connectionManager: IConnectionManager,
		private readonly eventService: SessionEventService
	) {}

	// ============================================
	// HELPER METHODS
	// ============================================

	private supportsAutonomousMode(modeId: string | undefined): boolean {
		return modeId === "agent" || modeId === "default" || modeId === "autopilot" || modeId === "build";
	}

	private setSessionAutonomous(sessionId: string, enabled: boolean): ResultAsync<void, AppError> {
		return api.setSessionAutonomous(sessionId, enabled);
	}

	private resolveDisplayGroupBaseModelId(group: ModelsForDisplay["groups"][number]): string | null {
		const firstModelId = group.models[0]?.modelId;
		if (!firstModelId) {
			return null;
		}

		const slashIndex = firstModelId.lastIndexOf("/");
		return slashIndex > 0 ? firstModelId.slice(0, slashIndex) : firstModelId;
	}

	private matchesDisplayGroupIdentity(
		group: ModelsForDisplay["groups"][number],
		currentModelId: string
	): boolean {
		const baseModelId = this.resolveDisplayGroupBaseModelId(group);
		if (!baseModelId) {
			return false;
		}

		if (baseModelId === currentModelId) {
			return true;
		}

		const trailingBaseToken = baseModelId.includes("/")
			? baseModelId.slice(baseModelId.lastIndexOf("/") + 1)
			: baseModelId;
		return trailingBaseToken === currentModelId;
	}

	private resolveModelFromDisplayGroup(
		availableModels: readonly Model[],
		currentModelId: string,
		modelsDisplay: ModelsForDisplay | null | undefined
	): Model | null {
		if (!modelsDisplay || modelsDisplay.groups.length === 0) {
			return null;
		}

		const matchingGroup =
			modelsDisplay.groups.find((group) =>
				this.matchesDisplayGroupIdentity(group, currentModelId)
			) ?? null;

		if (!matchingGroup) {
			return null;
		}

		for (const displayModel of matchingGroup.models) {
			const resolvedModel =
				availableModels.find((model) => model.id === displayModel.modelId) ?? null;
			if (resolvedModel) {
				return resolvedModel;
			}
		}

		return null;
	}

	/**
	 * Resolve the current model from ACP response, handling mismatches gracefully.
	 * Some agents return a base model ID while available models include variant suffixes.
	 */
	private resolveCurrentModel(
		availableModels: readonly Model[],
		currentModelId: string | null | undefined,
		modelsDisplay: ModelsForDisplay | null | undefined,
		allowsImplicitModelSelection: boolean
	): Model | null {
		if (availableModels.length === 0) {
			return null;
		}

		if (currentModelId) {
			const exact = availableModels.find((model) => model.id === currentModelId);
			if (exact) {
				return exact;
			}

			const groupedVariant = this.resolveModelFromDisplayGroup(
				availableModels,
				currentModelId,
				modelsDisplay
			);
			if (groupedVariant) {
				return groupedVariant;
			}
		}

		return allowsImplicitModelSelection ? (availableModels[0] ?? null) : null;
	}

	// ============================================
	// SESSION CONNECTION LIFECYCLE
	// ============================================

	/**
	 * Create a new session and seed local state for a not-yet-live ACP session.
	 */
	createSession(
		options: {
			projectPath: string;
			agentId: string;
			title?: string;
			initialAutonomousEnabled?: boolean;
			initialModeId?: string;
			initialModelId?: string;
			worktreePath?: string;
			launchToken?: string;
		},
		eventHandler: SessionEventHandler
	): ResultAsync<CreatedSessionResult, AppError> {
		const sessionCwd = options.worktreePath ? options.worktreePath : options.projectPath;
		logger.info("[first-send-trace] connection manager createSession", {
			projectPath: options.projectPath,
			worktreePath: options.worktreePath ? options.worktreePath : null,
			sessionCwd,
			agentId: options.agentId,
		});
		return api
			.newSession(
				sessionCwd,
				options.agentId,
				options.launchToken,
				options.initialModelId,
				options.initialModeId
			)
			.andThen((result) =>
				preferencesStore
					.ensureLoaded()
					.orElse((error) => {
						logger.warn("Failed to load model preferences after session creation", {
							sessionId: result.sessionId,
							agentId: options.agentId,
							error,
						});
						return okAsync(undefined);
					})
					.map(() => result)
			)
			.andThen((result) => {
				const sessionId = result.sessionId;
				if (result.deferredCreation === true) {
					const modelState = getProviderAwareSessionModelState(result.models);
					const rawModels = modelState.availableModels;
					const rawProviderMetadata = modelState.providerMetadata;
					const providerMetadata = rawProviderMetadata ?? undefined;
					const availableModels: Model[] =
						rawModels === undefined
							? []
							: rawModels.map((m) => ({
									id: m.modelId,
									provider: m.provider ?? undefined,
									name: m.name,
									description: m.description ?? undefined,
								}));
					const rawModes = result.modes?.availableModes;
					const availableModes: Mode[] =
						rawModes === undefined
							? []
							: rawModes.map((m) => ({
									id: m.id,
									name: m.name,
									description: m.description ?? undefined,
								}));
					const modelsDisplay = modelState.modelsDisplay ?? undefined;

					if (rawModels !== undefined) {
						preferencesStore.updateModelsCache(options.agentId, availableModels);
					}
					preferencesStore.updateProviderMetadataCache(options.agentId, providerMetadata);
					preferencesStore.updateModelsDisplayCache(options.agentId, modelsDisplay);
					if (rawModes !== undefined) {
						preferencesStore.updateModesCache(options.agentId, availableModes);
					}
					this.transientProjectionManager.initializeTransientProjection(sessionId);
					logger.info("Deferred session creation is pending provider identity promotion", {
						sessionId,
						creationAttemptId: result.creationAttemptId ?? null,
						sequenceId: result.sequenceId ?? null,
						agentId: options.agentId,
					});
					return okAsync({
						kind: "pending" as const,
						sessionId,
						creationAttemptId: result.creationAttemptId ?? null,
						projectPath: options.projectPath,
						projectName: extractProjectName(options.projectPath),
						projectColor: generateFallbackProjectColor(options.projectPath),
						managed: true as const,
						sequenceId: result.sequenceId ?? null,
						agentId: options.agentId,
						title: options.title ?? null,
						worktreePath: options.worktreePath ?? null,
					});
				}
				const now = new Date();
				const modelState = getProviderAwareSessionModelState(result.models);
				const {
					availableModels: rawModels,
					currentModelId,
					modelsDisplay: rawModelsDisplay,
					providerMetadata: rawProviderMetadata,
				} = modelState;
				const providerMetadata = rawProviderMetadata ?? undefined;
				const modelsDisplay = rawModelsDisplay ?? undefined;

				const rawModes = result.modes?.availableModes;
				const availableModes: Mode[] =
					rawModes === undefined
						? []
						: rawModes.map((m) => ({
								id: m.id,
								name: m.name,
								description: m.description ?? undefined,
							}));

				const availableModels: Model[] =
					rawModels === undefined
						? []
						: rawModels.map((m) => ({
								id: m.modelId,
								provider: m.provider ?? undefined,
								name: m.name,
								description: m.description ?? undefined,
							}));
				let currentMode = availableModes.find((m) => m.id === result.modes?.currentModeId) ?? null;
				let currentModel = this.resolveCurrentModel(
					availableModels,
					currentModelId,
					modelsDisplay,
					providerMetadata?.allowsImplicitModelSelection ?? true
				);
				const explicitInitialMode = options.initialModeId
					? (availableModes.find((mode) => mode.id === options.initialModeId) ?? null)
					: null;
				const explicitInitialModel = options.initialModelId
					? (availableModels.find((model) => model.id === options.initialModelId) ?? null)
					: null;
				const explicitSelectionError =
					options.initialModeId && explicitInitialMode === null
						? new AgentError(
								"setMode",
								new Error(`Requested mode '${options.initialModeId}' is not available`)
							)
						: options.initialModelId && explicitInitialModel === null
							? new AgentError(
									"setModel",
									new Error(`Requested model '${options.initialModelId}' is not available`)
								)
							: null;
				const hasExplicitInitialSelection =
					explicitInitialMode !== null || explicitInitialModel !== null;
				const targetMode = explicitInitialMode ? explicitInitialMode : currentMode;
				const targetModeChanged =
					explicitInitialMode !== null && explicitInitialMode.id !== currentMode?.id;
				const targetModel = explicitInitialModel ?? currentModel;

				const applyInitialSelection: ResultAsync<
					{ currentMode: Mode | null; currentModel: Model | null },
					AppError
				> = explicitSelectionError
					? errAsync(explicitSelectionError)
					: hasExplicitInitialSelection
					? (targetModeChanged && targetMode
							? api.setMode(sessionId, targetMode.id)
							: okAsync(undefined)
						)
							.andThen(() => {
								const shouldApplyExplicitModel =
									explicitInitialModel !== null &&
									(targetModeChanged || explicitInitialModel.id !== currentModel?.id);

								if (shouldApplyExplicitModel && targetModel) {
									return api.setModel(sessionId, targetModel.id);
								}

								return okAsync(undefined);
							})
							.map(() => ({
								currentMode: targetMode,
								currentModel: targetModel,
							}))
					: okAsync({
							currentMode,
							currentModel,
						});

				return applyInitialSelection
					.orElse((error) =>
						closeCreatedSessionAfterSelectionFailure<{
							currentMode: Mode | null;
							currentModel: Model | null;
						}>(sessionId, error)
					)
					.andThen((selection) => {
						currentMode = selection.currentMode;
						currentModel = selection.currentModel;

						const requestedAutonomous = options.initialAutonomousEnabled === true;
						const canEnableAutonomous = this.supportsAutonomousMode(
							currentMode ? currentMode.id : undefined
						);
						const applyInitialAutonomous =
							requestedAutonomous && canEnableAutonomous
								? this.setSessionAutonomous(sessionId, true)
										.map(() => true)
										.orElse((error) => {
											logger.warn(
												"Failed to sync initial autonomous policy after session creation",
												{
													sessionId,
													modeId: currentMode ? currentMode.id : null,
													error,
												}
											);
											return okAsync(false);
										})
								: okAsync(false);

						return applyInitialAutonomous.map(() => {
							// Cache available models and modes for settings/optimistic display
							if (rawModels !== undefined) {
								preferencesStore.updateModelsCache(options.agentId, availableModels);
							}
							preferencesStore.updateProviderMetadataCache(options.agentId, providerMetadata);
							preferencesStore.updateModelsDisplayCache(options.agentId, modelsDisplay);
							if (rawModes !== undefined) {
								preferencesStore.updateModesCache(options.agentId, availableModes);
							}
							logger.info("Provider model capabilities on session creation", {
								sessionId,
								agentId: options.agentId,
								responseCurrentModelId: currentModelId ? currentModelId : null,
								availableModelIds: availableModels.map((model) => model.id),
								cachedModelIds: preferencesStore
									.getCachedModels(options.agentId)
									.map((model) => model.id),
							});

							// Initialize per-mode model memory with current mode choice
							if (currentMode && currentModel) {
								preferencesStore.setSessionModelForMode(
									sessionId,
									currentMode.id,
									currentModel.id
								);
							}

							// Store only cold data (identity + metadata) in the sessions array
							const sessionCold: SessionCold = {
								id: sessionId,
								projectPath: options.projectPath,
								agentId: options.agentId,
								worktreePath: options.worktreePath,
								title: options.title || "New Thread",
								updatedAt: now,
								createdAt: now,
								sessionLifecycleState: "created",
								parentId: null,
								sequenceId: result.sequenceId === null ? undefined : result.sequenceId,
							};

							this.transientProjectionManager.initializeTransientProjection(sessionId);

							this.stateWriter.addSession(sessionCold);

							// Persist worktree path to DB for restore across app restarts
							if (options.worktreePath) {
								tauriClient.history
									.setSessionWorktreePath(
										sessionId,
										options.worktreePath,
										options.projectPath,
										options.agentId
									)
									.mapErr((error) => {
										logger.error("Failed to persist worktree path to DB", {
											sessionId,
											worktreePath: options.worktreePath,
											error,
										});
									});
							}

							// New sessions have empty content immediately, but their transport
							// remains disconnected until resume or first send activates them.
							this.connectionManager.sendContentLoad(sessionId);
							this.connectionManager.sendContentLoaded(sessionId);

							// Flush any pending events that arrived before session was added
							this.eventService.flushPendingEvents(sessionId, eventHandler);

							logger.debug("Session created and left disconnected pending activation", {
								sessionId,
							});

							return {
								kind: "ready" as const,
								session: sessionCold,
								sessionOpen: result.sessionOpen ?? null,
							};
						});
					});
			})
			.mapErr((error) => {
				logger.error("Failed to create session", { error });
				if (
					error instanceof TauriCommandError &&
					error.domain?.type === "acp" &&
					error.domain.data.type === "authentication_required"
				) {
					// Not a failure — a recoverable sign-in precondition. Carry the
					// typed signal so the panel renders a neutral sign-in card.
					const auth = error.domain.data.data;
					return new AuthenticationRequiredError(auth.agent, auth.instructions, error);
				}
				if (
					error instanceof TauriCommandError &&
					error.domain?.type === "acp" &&
					error.domain.data.type === "creation_failed"
				) {
					const failure = error.domain.data.data;
					return new CreationFailureError(
						failure.kind,
						failure.message,
						failure.sessionId,
						failure.creationAttemptId,
						failure.retryable,
						failure.failureReason ?? null,
						error
					);
				}
				const message = error instanceof Error ? error.message : String(error);
				return new ConnectionError(
					`Failed to create session: ${message}`,
					error instanceof Error ? error : undefined
				);
			});
	}

	/**
	 * Connect to a session (resume or create ACP connection).
	 *
	 * Fire-and-forget: sends the resume invoke to Rust (which returns immediately
	 * after validation), then waits for a connectionComplete/connectionFailed
	 * lifecycle event via the SSE bridge. Hot-state population happens after
	 * the lifecycle waiter resolves.
	 */
	connectSession(
		sessionId: string,
		eventHandler: SessionEventHandler,
		options?: ConnectSessionOptions
	): ResultAsync<SessionCold, AppError> {
		const sessionIdentity = this.stateReader.getSessionIdentity(sessionId);
		if (!sessionIdentity) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const effectiveAgentId = options?.agentOverrideId ?? sessionIdentity.agentId;

		const canSend = canSendFromCanonical(this.stateReader, sessionId);
		if (canSend && options?.forceReconnect !== true) {
			logger.info("Session already connected, skipping", {
				sessionId,
				canSend,
			});
			const connectedSessionMetadata = this.stateReader.getSessionMetadata(sessionId);
			if (!connectedSessionMetadata) {
				return errAsync(new SessionNotFoundError(sessionId));
			}
			return okAsync(sessionColdFromSlices(sessionIdentity, connectedSessionMetadata));
		}
		const pending = this.pendingConnections.get(sessionId);
		if (pending) {
			logger.debug("Connection already in flight, returning pending", { sessionId });
			return pending;
		}

		this.connectionManager.setConnecting(sessionId, true);
		// Start connection in state machine
		this.connectionManager.sendConnectionConnect(sessionId);

		const resumeCwd = sessionIdentity.projectPath;
		const attemptId = nextAttemptId++;
		const lifecycleWaiter = this.eventService.waitForConnectionMaterialization(
			sessionId,
			WATCHDOG_TIMEOUT_MS
		);
		// Attach rejection handler immediately so that if Rust emits a failure event
		// before api.resumeSession() resolves (e.g. agent install fails fast), the
		// rejection is already handled and won't fire window.unhandledrejection.
		const lifecycleOutcome: Promise<ConnectionMaterializationOutcome> =
			lifecycleWaiter.promise.then(
				(data) => ({ kind: "ok", data }),
				(error) => ({ kind: "error", error: error as AppError })
			);
		const awaitConnectionMaterialization = () =>
			ResultAsync.fromPromise(
				(() => {
					const readinessReconciler = createReadyConnectionReconciler(sessionId, eventHandler);
					const readinessOutcome: Promise<ConnectionMaterializationOutcome> =
						readinessReconciler.promise.then(
							(data) => ({ kind: "ok", data }),
							(error) => ({ kind: "error", error: error as AppError })
						);
					return Promise.race([lifecycleOutcome, readinessOutcome])
						.finally(() => {
							readinessReconciler.cancel();
						})
						.then((outcome) => {
							if (outcome.kind === "error") {
								throw outcome.error;
							}
							return outcome.data;
						});
				})(),
				(err) => err as AppError
			);

		// Fire-and-forget: send resume invoke, then wait for lifecycle event
		const connection = preferencesStore
			.ensureLoaded()
			.orElse((error) => {
				logger.warn("Failed to load provider metadata before reconnect", {
					sessionId,
					agentId: sessionIdentity.agentId,
					error,
				});
				return okAsync(undefined);
			})
			.andThen(() =>
				api.resumeSession(
					sessionId,
					resumeCwd,
					attemptId,
					options?.agentOverrideId,
					undefined,
					options?.openToken
				)
			)
			.andThen(() => awaitConnectionMaterialization())
			.andThen((data) => {
				this.handleConnectionComplete(sessionId, effectiveAgentId, data);
				const connectedSessionIdentity = this.stateReader.getSessionIdentity(sessionId);
				const connectedSessionMetadata = this.stateReader.getSessionMetadata(sessionId);
				if (!connectedSessionIdentity || !connectedSessionMetadata) {
					return errAsync(new SessionNotFoundError(sessionId));
				}
				return okAsync(sessionColdFromSlices(connectedSessionIdentity, connectedSessionMetadata));
			})
			.map((cold) => {
				this.pendingConnections.delete(sessionId);
				return cold;
			})
			.mapErr((error) => {
				this.pendingConnections.delete(sessionId);
				this.connectionManager.setConnecting(sessionId, false);
				lifecycleWaiter.cancel();

				// Connection failed in state machine
				this.connectionManager.sendConnectionError(sessionId);

				// GOD: Rust emits a Failed lifecycle envelope via emit_lifecycle_event
				// (ConnectionFailed → SessionStateGraph snapshot). Canonical projection
				// is authoritative — no client-side synthesis.

				logger.error("Failed to connect session", { sessionId, error });
				return new ConnectionError(sessionId, error instanceof Error ? error : undefined);
			});

		this.pendingConnections.set(sessionId, connection);
		return connection;
	}

	/**
	 * Handle connection materialization completion.
	 *
	 * Canonical envelopes have already applied lifecycle/capability state by the time this runs.
	 * This method only updates provider preference caches that are still maintained outside the
	 * canonical session graph.
	 */
	private handleConnectionComplete(
		sessionId: string,
		effectiveAgentId: string,
		data: ConnectionCompleteData
	): void {
		const modelState = getProviderAwareSessionModelState(data.models);
		const {
			availableModels: rawModels,
			currentModelId,
			modelsDisplay: rawModelsDisplay,
			providerMetadata: rawProviderMetadata,
		} = modelState;
		const providerMetadata = rawProviderMetadata ?? undefined;
		const modelsDisplay = rawModelsDisplay ?? undefined;

		const rawModes = data.modes?.availableModes;
		const availableModes: Mode[] =
			rawModes === undefined
				? []
				: rawModes.map((m) => ({
						id: m.id,
						name: m.name,
						description: m.description ?? undefined,
					}));

		const availableModels: Model[] =
			rawModels === undefined
				? []
				: rawModels.map((m) => ({
						id: m.modelId,
						provider: m.provider ?? undefined,
						name: m.name,
						description: m.description ?? undefined,
					}));
		const initialModel = this.resolveCurrentModel(
			availableModels,
			currentModelId,
			modelsDisplay,
			providerMetadata?.allowsImplicitModelSelection ?? true
		);

		// Cache available models and modes for settings/optimistic display
		if (rawModels !== undefined) {
			preferencesStore.updateModelsCache(effectiveAgentId, availableModels);
		}
		preferencesStore.updateProviderMetadataCache(effectiveAgentId, providerMetadata);
		preferencesStore.updateModelsDisplayCache(effectiveAgentId, modelsDisplay);
		if (rawModes !== undefined) {
			preferencesStore.updateModesCache(effectiveAgentId, availableModes);
		}
		logger.info("Provider model capabilities on session resume", {
			sessionId,
			agentId: effectiveAgentId,
			availableModelIds: availableModels.map((model) => model.id),
			currentModelId: initialModel?.id ?? null,
		});

		this.connectionManager.setConnecting(sessionId, false);
	}

	/**
	 * Disconnect a session and clean up its subprocess.
	 *
	 * This method:
	 * 1. Updates local state (state machine, local transient state)
	 * 2. Calls the backend to close the session and kill the subprocess
	 *
	 * The subprocess cleanup is fire-and-forget to avoid blocking the UI.
	 */
	disconnectSession(sessionId: string): void {
		const sessionIdentity = this.stateReader.getSessionIdentity(sessionId);
		if (!sessionIdentity) return;
		this.pendingConnections.delete(sessionId);

		// Disconnect in state machine
		this.connectionManager.sendDisconnect(sessionId);

		// Read provider session id before clearing local transport mapping.
		const acpSessionId = this.stateReader.getSessionAcpSessionId(sessionId);

		// Pure GOD: Rust emits a Detached(ClosedByClient) lifecycle envelope from
		// `acp_close_session` before tearing down the subprocess. Canonical
		// projection updates via the normal envelope handler — no client-side
		// synthesis.

		this.transientProjectionManager.updateTransientProjection(sessionId, {
			acpSessionId: null,
		});

		// Close the session on the backend to kill the subprocess
		// Fire-and-forget: don't block UI on subprocess cleanup
		if (acpSessionId) {
			api.closeSession(acpSessionId).mapErr((error) => {
				logger.warn("Failed to close session subprocess", { sessionId, acpSessionId, error });
			});
		}

		logger.debug("Session disconnected", { sessionId });
	}

	// ============================================
	// MODEL/MODE MANAGEMENT
	// ============================================

	/**
	 * Set model for a session.
	 * Also tracks the model choice per mode for this session.
	 */
	setModel(sessionId: string, modelId: string): ResultAsync<void, AppError> {
		const sessionIdentity = this.stateReader.getSessionIdentity(sessionId);
		if (!sessionIdentity) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		if (!canSendFromCanonical(this.stateReader, sessionId)) {
			return errAsync(new ConnectionError(sessionId));
		}

		logger.debug("Setting model", { sessionId, modelId });

		// Track model choice per mode for this session
		const currentModeId = canonicalCurrentModeId(this.stateReader, sessionId);
		if (currentModeId !== null) {
			preferencesStore.setSessionModelForMode(sessionId, currentModeId, modelId);
		}

		return api
			.setModel(sessionIdentity.id, modelId)
			.map(() => {
				logger.debug("Model set successfully", { sessionId, modelId });
				return undefined;
			})
			.mapErr((error) => {
				logger.error("Failed to set model", { sessionId, modelId, error });
				return new AgentError("setModel", error instanceof Error ? error : undefined);
			});
	}

	/**
	 * Set mode for a session.
	 * Also applies model defaults or restores previous model choice for new mode.
	 *
	 * Flow:
	 * 1. Switch to new mode (optimistic)
	 * 2. Check if user previously selected a model for this mode in this session
	 *    - If yes, restore that model
	 *    - If no, apply default model for this mode (if configured)
	 * 3. Update per-mode model memory
	 */
	setMode(sessionId: string, modeId: string): ResultAsync<void, AppError> {
		const sessionIdentity = this.stateReader.getSessionIdentity(sessionId);
		if (!sessionIdentity) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		if (!canSendFromCanonical(this.stateReader, sessionId)) {
			return errAsync(new ConnectionError(sessionId));
		}

		const availableModes = canonicalAvailableModes(this.stateReader, sessionId);
		const availableModels = canonicalAvailableModels(this.stateReader, sessionId);
		if (availableModes === null || availableModels === null) {
			return errAsync(new ConnectionError(sessionId));
		}
		const newMode = availableModes.find((m) => m.id === modeId) ?? null;
		const oldAutonomousEnabled = canonicalAutonomousEnabled(this.stateReader, sessionId);
		const nextAutonomousEnabled =
			oldAutonomousEnabled === null
				? null
				: oldAutonomousEnabled && this.supportsAutonomousMode(newMode ? newMode.id : undefined);
		logger.debug("Setting mode", { sessionId, modeId });

		const applyMode = api.setMode(sessionIdentity.id, modeId);

		return applyMode
			.andThen(() => {
				logger.debug("Mode set successfully", { sessionId, modeId });

				const syncAutonomousPolicy =
					oldAutonomousEnabled !== nextAutonomousEnabled
						? nextAutonomousEnabled === null
							? okAsync(undefined)
							: this.setSessionAutonomous(sessionIdentity.id, nextAutonomousEnabled)
						: okAsync(undefined);

				return syncAutonomousPolicy;
			})
			.andThen(() => {
				logger.debug("Session autonomous policy synced for mode change", {
					sessionId,
					modeId,
					autonomousEnabled: nextAutonomousEnabled,
				});

				// After mode switch succeeds, handle model for new mode
				if (!newMode) {
					return okAsync(undefined);
				}

				// Check if user previously selected a model for this mode in this session
				const previousModelForMode = preferencesStore.getSessionModelForMode(sessionId, modeId);
				if (
					previousModelForMode &&
					availableModels.some((m) => m.id === previousModelForMode) === true
				) {
					// Restore user's previous choice for this mode
					logger.debug("Restoring previous model choice for mode", {
						sessionId,
						modeId,
						modelId: previousModelForMode,
					});
					return this.setModel(sessionId, previousModelForMode);
				}

				return okAsync(undefined);
			})
			.mapErr((error) => {
				logger.error("Failed to set mode", { sessionId, modeId, error });
				return new AgentError("setMode", error instanceof Error ? error : undefined);
			});
	}

	setAutonomousEnabled(
		sessionId: string,
		enabled: boolean,
		eventHandler?: SessionEventHandler
	): ResultAsync<void, AppError> {
		const sessionIdentity = this.stateReader.getSessionIdentity(sessionId);
		if (!sessionIdentity) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const targetEnabled =
			enabled &&
			this.supportsAutonomousMode(canonicalCurrentModeId(this.stateReader, sessionId) ?? undefined);
		if (this.stateReader.getSessionAutonomousTransitionBusy(sessionId)) {
			return errAsync(
				new AgentError(
					"setAutonomousEnabled",
					new Error("Autonomous transition already in progress")
				)
			);
		}

		const rollbackAutonomous = (error: AppError) => {
			this.transientProjectionManager.updateTransientProjection(sessionId, {
				autonomousTransition: "idle",
			});
			logger.error("Failed to update Autonomous session policy, rolling back", {
				sessionId,
				enabled: targetEnabled,
				error,
			});
			return new AgentError("setAutonomousEnabled", error instanceof Error ? error : undefined);
		};

		void eventHandler;

		this.transientProjectionManager.updateTransientProjection(sessionId, {
			autonomousTransition: targetEnabled ? "enabling" : "disabling",
		});

		return this.setSessionAutonomous(sessionId, targetEnabled).mapErr(rollbackAutonomous);
	}

	/**
	 * Set a configuration option for a session.
	 */
	setConfigOption(sessionId: string, configId: string, value: string): ResultAsync<void, AppError> {
		const sessionIdentity = this.stateReader.getSessionIdentity(sessionId);
		if (!sessionIdentity) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		if (!canSendFromCanonical(this.stateReader, sessionId)) {
			return errAsync(new ConnectionError(sessionId));
		}

		logger.debug("Setting config option", { sessionId, configId, value });

		return api
			.setConfigOption(sessionIdentity.id, configId, value)
			.map(() => {
				logger.debug("Config option set successfully", { sessionId, configId });
			})
			.mapErr((error) => {
				logger.error("Failed to set config option", {
					sessionId,
					configId,
					error,
				});
				return new AgentError("setConfigOption", error instanceof Error ? error : undefined);
			});
	}

	/**
	 * Cancel streaming for a session.
	 */
	cancelStreaming(sessionId: string): ResultAsync<void, AppError> {
		const sessionIdentity = this.stateReader.getSessionIdentity(sessionId);
		if (!sessionIdentity) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		// Cancellation only requires an active WebSocket connection — canSend is false
		// while streaming (lifecycle is not Ready), so we must not gate on it here.
		if (!canonicalWireOpen(this.stateReader, sessionId)) {
			return errAsync(new ConnectionError(sessionId));
		}

		return api
			.stopStreaming(sessionIdentity.id)
			.map(() => {
				// Transition machine STREAMING -> READY for machine-backed selectors.
				this.connectionManager.sendResponseComplete(sessionId);
				logger.debug("Streaming cancelled", { sessionId });
				return undefined;
			})
			.mapErr((error) => {
				logger.error("Failed to cancel streaming", { sessionId, error });
				return new AgentError("cancelStreaming", error instanceof Error ? error : undefined);
			});
	}
}
