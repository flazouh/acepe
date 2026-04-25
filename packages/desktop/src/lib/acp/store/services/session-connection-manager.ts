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
import {
	type ModelsForDisplay,
	normalizeModelsForDisplay,
	type ProviderMetadataProjection,
	resolveProviderMetadataProjection,
} from "../../../services/acp-provider-metadata.js";
import type {
	SessionModelState as AcpSessionModelState,
	SessionOpenResult,
} from "../../../services/acp-types.js";
import { tauriClient } from "../../../utils/tauri-client.js";
import type { AppError } from "../../errors/app-error.js";
import { AgentError, ConnectionError, SessionNotFoundError } from "../../errors/app-error.js";
import type { ModeType } from "../../types/agent-model-preferences.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { createLogger } from "../../utils/logger.js";
import * as preferencesStore from "../agent-model-preferences-store.svelte.js";
import { api } from "../api.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import type {
	ConnectionCompleteData,
	SessionEventService,
} from "../session-event-service.svelte.js";
import type { Mode, Model, SessionCold } from "../types.js";
import type {
	ICapabilitiesManager,
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
const WATCHDOG_TIMEOUT_MS = 90_000;

/** Global attempt counter for stale-event detection. */
let nextAttemptId = 1;

interface ConnectSessionOptions {
	agentOverrideId?: string;
	openToken?: string;
}

export interface CreatedSessionResult {
	readonly session: SessionCold;
	readonly sessionOpen: SessionOpenResult | null;
}

type ProviderAwareSessionModelState = AcpSessionModelState & {
	readonly providerMetadata?: ProviderMetadataProjection | null;
	readonly modelsDisplay?: ModelsForDisplay | null;
};

function getProviderAwareSessionModelState(
	modelState: AcpSessionModelState | null | undefined
): ProviderAwareSessionModelState {
	if (!modelState) {
		return {};
	}

	return modelState as ProviderAwareSessionModelState;
}

function canSendFromCanonicalOrCompatibility(
	reader: ISessionStateReader,
	sessionId: string,
	compatibilityCanSend: boolean
): boolean {
	return reader.getSessionCanSend?.(sessionId) ?? compatibilityCanSend;
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
		private readonly hotStateManager: ITransientProjectionManager,
		private readonly capabilitiesManager: ICapabilitiesManager,
		private readonly entryManager: IEntryManager,
		private readonly connectionManager: IConnectionManager,
		private readonly eventService: SessionEventService
	) {}

	// ============================================
	// HELPER METHODS
	// ============================================

	/**
	 * Convert ACP mode ID to user-friendly mode type for preferences.
	 * "plan" mode → plan, all others (e.g., "acceptEdits") → build
	 */
	private getModeType(modeId: string | undefined): ModeType {
		return modeId === CanonicalModeId.PLAN ? CanonicalModeId.PLAN : CanonicalModeId.BUILD;
	}

	private supportsAutonomousMode(modeId: string | undefined): boolean {
		return modeId === CanonicalModeId.BUILD;
	}

	private resolveProviderMetadata(
		agentId: string,
		providerMetadata: ProviderMetadataProjection | null | undefined
	): ProviderMetadataProjection {
		return resolveProviderMetadataProjection(
			agentId,
			providerMetadata ?? preferencesStore.getCachedProviderMetadata(agentId),
			agentId
		);
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
		modelsDisplay: ModelsForDisplay | null | undefined,
		providerMetadata: ProviderMetadataProjection
	): Model | null {
		if (!modelsDisplay || modelsDisplay.groups.length === 0) {
			return null;
		}

		const matchingGroup =
			modelsDisplay.groups.find((group) =>
				this.matchesDisplayGroupIdentity(group, currentModelId)
			) ??
			(providerMetadata.variantGroup === "reasoningEffort" && modelsDisplay.groups.length === 1
				? modelsDisplay.groups[0]
				: null);

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

	private resolveDefaultModelForMode(
		agentId: string,
		modeId: string | undefined,
		availableModels: readonly Model[]
	): Model | null {
		const defaultModelId = preferencesStore.getDefaultModel(agentId, this.getModeType(modeId));
		if (!defaultModelId) {
			return null;
		}

		return availableModels.find((model) => model.id === defaultModelId) ?? null;
	}

	/**
	 * Resolve the current model from ACP response, handling mismatches gracefully.
	 * Some agents return a base model ID while available models include variant suffixes.
	 */
	private resolveCurrentModel(
		agentId: string,
		availableModels: readonly Model[],
		currentModelId: string | null | undefined,
		modelsDisplay: ModelsForDisplay | null | undefined,
		providerMetadata: ProviderMetadataProjection | null | undefined
	): Model | null {
		if (availableModels.length === 0) {
			return null;
		}

		if (currentModelId) {
			const exact = availableModels.find((model) => model.id === currentModelId);
			if (exact) {
				return exact;
			}

			const resolvedProviderMetadata = this.resolveProviderMetadata(agentId, providerMetadata);
			const groupedVariant = this.resolveModelFromDisplayGroup(
				availableModels,
				currentModelId,
				modelsDisplay,
				resolvedProviderMetadata
			);
			if (groupedVariant) {
				return groupedVariant;
			}
		}

		return availableModels[0] ?? null;
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
			.newSession(sessionCwd, options.agentId, options.launchToken)
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
				const now = new Date();
				const modelState = getProviderAwareSessionModelState(result.models);
				const {
					availableModels: rawModels = [],
					currentModelId,
					modelsDisplay: rawModelsDisplay,
					providerMetadata: rawProviderMetadata,
				} = modelState;
				const providerMetadata = this.resolveProviderMetadata(options.agentId, rawProviderMetadata);
				const modelsDisplay =
					normalizeModelsForDisplay(
						options.agentId,
						rawModelsDisplay,
						options.agentId,
						providerMetadata
					) ?? undefined;

				const availableModes: Mode[] = (result.modes?.availableModes ?? []).map((m) => ({
					id: m.id,
					name: m.name,
					description: m.description ?? undefined,
				}));

				const availableModels: Model[] = rawModels.map((m) => ({
					id: m.modelId,
					name: m.name,
					description: m.description ?? undefined,
				}));
				const availableCommands = result.availableCommands ?? [];
				const configOptions = result.configOptions ?? [];

				let currentMode = availableModes.find((m) => m.id === result.modes?.currentModeId) ?? null;
				let currentModel = this.resolveCurrentModel(
					options.agentId,
					availableModels,
					currentModelId,
					modelsDisplay,
					providerMetadata
				);
				const explicitInitialMode = options.initialModeId
					? (availableModes.find((mode) => mode.id === options.initialModeId) ?? null)
					: null;
				const explicitInitialModel = options.initialModelId
					? (availableModels.find((model) => model.id === options.initialModelId) ?? null)
					: null;
				const hasExplicitInitialSelection =
					explicitInitialMode !== null || explicitInitialModel !== null;
				const targetMode = explicitInitialMode ? explicitInitialMode : currentMode;
				const targetModeChanged =
					explicitInitialMode !== null && explicitInitialMode.id !== currentMode?.id;
				const defaultModelForTargetMode = this.resolveDefaultModelForMode(
					options.agentId,
					targetMode ? targetMode.id : undefined,
					availableModels
				);
				const targetModel = explicitInitialModel
					? explicitInitialModel
					: defaultModelForTargetMode
						? defaultModelForTargetMode
						: currentModel;

				const applyInitialSelection = hasExplicitInitialSelection
					? (targetModeChanged && targetMode
							? api.setMode(sessionId, targetMode.id)
							: okAsync(undefined)
						)
							.andThen(() => {
								const shouldApplyExplicitModel =
									explicitInitialModel !== null &&
									(targetModeChanged || explicitInitialModel.id !== currentModel?.id);
								const shouldApplyModeDefaultModel =
									explicitInitialModel === null &&
									targetModeChanged &&
									targetModel !== null &&
									targetModel.id !== currentModel?.id;

								if ((shouldApplyExplicitModel || shouldApplyModeDefaultModel) && targetModel) {
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
					.orElse((error) => {
						logger.warn("Failed to apply initial mode/model after session creation", {
							sessionId,
							agentId: options.agentId,
							initialModeId: options.initialModeId ?? null,
							initialModelId: options.initialModelId ?? null,
							error,
						});
						return okAsync({
							currentMode,
							currentModel,
						});
					})
					.andThen((selection) => {
						currentMode = selection.currentMode;
						currentModel = selection.currentModel;

						if (!hasExplicitInitialSelection) {
							const defaultModel = this.resolveDefaultModelForMode(
								options.agentId,
								currentMode ? currentMode.id : undefined,
								availableModels
							);
							if (defaultModel) {
								currentModel = defaultModel;
								logger.debug("Applied default model on session creation", {
									sessionId,
									agentId: options.agentId,
									modeType: this.getModeType(currentMode ? currentMode.id : undefined),
									modelId: defaultModel.id,
								});
								api.setModel(sessionId, defaultModel.id).mapErr((err) => {
									logger.warn("Failed to set default model on ACP", {
										sessionId,
										modelId: defaultModel.id,
										error: err,
									});
								});
							}
						}

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

						return applyInitialAutonomous.map((autonomousEnabled) => {
							// Cache available models and modes for settings/optimistic display
							preferencesStore.updateModelsCache(options.agentId, availableModels);
							preferencesStore.updateProviderMetadataCache(options.agentId, providerMetadata);
							preferencesStore.updateModelsDisplayCache(
								options.agentId,
								modelsDisplay,
								providerMetadata
							);
							preferencesStore.updateModesCache(options.agentId, availableModes);
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
							if (currentMode) {
								preferencesStore.setSessionModelForMode(
									sessionId,
									currentMode.id,
									currentModel?.id ? currentModel.id : ""
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

							// Initialize hot state BEFORE adding the session to the store.
							// New sessions stay disconnected until canonical resume/first-send
							// materializes readiness, but we still seed optimistic mode/model
							// metadata so the composer and settings can render immediately.
							this.hotStateManager.initializeHotState(sessionId, {
								status: "idle",
								isConnected: false,
								turnState: "idle",
								connectionError: null,
								autonomousEnabled,
								currentMode,
								currentModel,
								availableCommands,
								configOptions,
								modelPerMode: currentMode
									? { [currentMode.id]: currentModel?.id ? currentModel.id : "" }
									: {},
							});

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

							// Store capabilities separately from cold data
							this.capabilitiesManager.updateCapabilities(sessionId, {
								availableModes,
								availableModels,
								availableCommands,
								modelsDisplay,
								providerMetadata,
							});

							// Mark as preloaded since it's a new session with no entries
							this.entryManager.markPreloaded(sessionId);

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
								session: sessionCold,
								sessionOpen: result.sessionOpen ?? null,
							};
						});
					});
			})
			.mapErr((error) => {
				logger.error("Failed to create session", { error });
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
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const effectiveAgentId = options?.agentOverrideId ?? session.agentId;

		const hotState = this.stateReader.getHotState(sessionId);
		const canSend = canSendFromCanonicalOrCompatibility(
			this.stateReader,
			sessionId,
			hotState.isConnected
		);
		if (canSend) {
			logger.info("Session already connected, skipping", {
				sessionId,
				canSend,
			});
			return okAsync(session);
		}
		const pending = this.pendingConnections.get(sessionId);
		if (pending) {
			logger.debug("Connection already in flight, returning pending", { sessionId });
			return pending;
		}

		this.connectionManager.setConnecting(sessionId, true);
		// Start connection in state machine
		this.connectionManager.sendConnectionConnect(sessionId);
		this.hotStateManager.updateHotState(sessionId, {
			status: "connecting",
			connectionError: null,
		});

		const resumeCwd = session.projectPath;
		const attemptId = nextAttemptId++;
		const lifecycleWaiter = this.eventService.waitForConnectionMaterialization(
			sessionId,
			WATCHDOG_TIMEOUT_MS
		);

		// Fire-and-forget: send resume invoke, then wait for lifecycle event
		const connection = preferencesStore
			.ensureLoaded()
			.orElse((error) => {
				logger.warn("Failed to load provider metadata before reconnect", {
					sessionId,
					agentId: session.agentId,
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
			.andThen(() => ResultAsync.fromPromise(lifecycleWaiter.promise, (err) => err as AppError))
			.andThen((data) => {
				this.handleConnectionComplete(sessionId, effectiveAgentId, data);
				const cold = this.stateReader.getSessionCold(sessionId);
				if (!cold) {
					return errAsync(new SessionNotFoundError(sessionId));
				}
				return okAsync(cold);
			})
			.map((cold) => {
				this.pendingConnections.delete(sessionId);
				return cold;
			})
			.mapErr((error) => {
				this.pendingConnections.delete(sessionId);
				this.connectionManager.setConnecting(sessionId, false);
				lifecycleWaiter.cancel();

				const errorMessage = error instanceof Error ? error.message : String(error);

				// Connection failed in state machine
				this.connectionManager.sendConnectionError(sessionId);

				this.hotStateManager.updateHotState(sessionId, {
					status: "error",
					isConnected: false,
					availableCommands: [],
					connectionError: errorMessage,
				});
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
			availableModels: rawModels = [],
			currentModelId,
			modelsDisplay: rawModelsDisplay,
			providerMetadata: rawProviderMetadata,
		} = modelState;
		const providerMetadata = this.resolveProviderMetadata(
			effectiveAgentId,
			rawProviderMetadata as ProviderMetadataProjection | undefined
		);
		const modelsDisplay =
			normalizeModelsForDisplay(
				effectiveAgentId,
				rawModelsDisplay as ModelsForDisplay | undefined,
				effectiveAgentId,
				providerMetadata
			) ?? undefined;

		const availableModes: Mode[] = (data.modes?.availableModes ?? []).map((m) => ({
			id: m.id,
			name: m.name,
			description: m.description ?? undefined,
		}));

		const availableModels: Model[] = rawModels.map((m) => ({
			id: m.modelId,
			name: m.name,
			description: m.description ?? undefined,
		}));
		const initialModel = this.resolveCurrentModel(
			effectiveAgentId,
			availableModels,
			currentModelId,
			modelsDisplay,
			providerMetadata
		);

		// Cache available models and modes for settings/optimistic display
		preferencesStore.updateModelsCache(effectiveAgentId, availableModels);
		preferencesStore.updateProviderMetadataCache(effectiveAgentId, providerMetadata);
		preferencesStore.updateModelsDisplayCache(effectiveAgentId, modelsDisplay, providerMetadata);
		preferencesStore.updateModesCache(effectiveAgentId, availableModes);
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
	 * 1. Updates local state (state machine, capabilities, hot state)
	 * 2. Calls the backend to close the session and kill the subprocess
	 *
	 * The subprocess cleanup is fire-and-forget to avoid blocking the UI.
	 */
	disconnectSession(sessionId: string): void {
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) return;
		this.pendingConnections.delete(sessionId);

		// Disconnect in state machine
		this.connectionManager.sendDisconnect(sessionId);

		// Clear ACP capabilities on disconnect
		this.capabilitiesManager.removeCapabilities(sessionId);

		// Read acpSessionId from hot state before clearing it
		const acpSessionId = this.stateReader.getHotState(sessionId).acpSessionId;

		this.hotStateManager.updateHotState(sessionId, {
			status: "idle",
			isConnected: false,
			turnState: "idle",
			acpSessionId: null,
			connectionError: null,
			availableCommands: [],
			modelPerMode: {},
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
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const hotState = this.stateReader.getHotState(sessionId);
		if (!canSendFromCanonicalOrCompatibility(this.stateReader, sessionId, hotState.isConnected)) {
			return errAsync(new ConnectionError(sessionId));
		}

		logger.debug("Setting model", { sessionId, modelId });

		// Track model choice per mode for this session
		if (hotState.currentMode) {
			preferencesStore.setSessionModelForMode(sessionId, hotState.currentMode.id, modelId);
		}

		return api
			.setModel(session.id, modelId)
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
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const hotState = this.stateReader.getHotState(sessionId);
		if (!canSendFromCanonicalOrCompatibility(this.stateReader, sessionId, hotState.isConnected)) {
			return errAsync(new ConnectionError(sessionId));
		}

		const capabilities = this.capabilitiesManager.getCapabilities(sessionId);
		const newMode = capabilities.availableModes.find((m) => m.id === modeId);
		const oldAutonomousEnabled = hotState.autonomousEnabled;
		const nextAutonomousEnabled =
			oldAutonomousEnabled && this.supportsAutonomousMode(newMode ? newMode.id : undefined);
		logger.debug("Setting mode", { sessionId, modeId });

		const applyMode = api.setMode(session.id, modeId);

		return applyMode
			.andThen(() => {
				logger.debug("Mode set successfully", { sessionId, modeId });

				const syncAutonomousPolicy =
					oldAutonomousEnabled !== nextAutonomousEnabled
						? this.setSessionAutonomous(session.id, nextAutonomousEnabled)
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
					capabilities.availableModels.some((m) => m.id === previousModelForMode)
				) {
					// Restore user's previous choice for this mode
					logger.debug("Restoring previous model choice for mode", {
						sessionId,
						modeId,
						modelId: previousModelForMode,
					});
					return this.setModel(sessionId, previousModelForMode);
				}

				// No previous choice, check for default model for this mode
				const modeType = this.getModeType(modeId);
				const defaultModelId = preferencesStore.getDefaultModel(session.agentId, modeType);
				if (defaultModelId && capabilities.availableModels.some((m) => m.id === defaultModelId)) {
					logger.debug("Applying default model for mode", {
						sessionId,
						modeId,
						modeType,
						modelId: defaultModelId,
					});
					return this.setModel(sessionId, defaultModelId);
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
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const hotState = this.stateReader.getHotState(sessionId);
		const targetEnabled =
			enabled &&
			this.supportsAutonomousMode(hotState.currentMode ? hotState.currentMode.id : undefined);
		if (hotState.autonomousTransition !== "idle") {
			return errAsync(
				new AgentError(
					"setAutonomousEnabled",
					new Error("Autonomous transition already in progress")
				)
			);
		}

		const previousAutonomousEnabled = hotState.autonomousEnabled;
		const rollbackAutonomous = (error: AppError) => {
			this.hotStateManager.updateHotState(sessionId, {
				autonomousEnabled: previousAutonomousEnabled,
				autonomousTransition: "idle",
			});
			logger.error("Failed to update Autonomous session policy, rolling back", {
				sessionId,
				enabled: targetEnabled,
				error,
			});
			return new AgentError("setAutonomousEnabled", error instanceof Error ? error : undefined);
		};

		if (!canSendFromCanonicalOrCompatibility(this.stateReader, sessionId, hotState.isConnected)) {
			this.hotStateManager.updateHotState(sessionId, {
				autonomousEnabled: targetEnabled,
				autonomousTransition: "idle",
			});
			return this.setSessionAutonomous(sessionId, targetEnabled).mapErr(rollbackAutonomous);
		}

		void session;
		void eventHandler;

		this.hotStateManager.updateHotState(sessionId, {
			autonomousEnabled: targetEnabled,
			autonomousTransition: targetEnabled ? "enabling" : "disabling",
		});

		return this.setSessionAutonomous(sessionId, targetEnabled)
			.map(() => {
				this.hotStateManager.updateHotState(sessionId, {
					autonomousEnabled: targetEnabled,
					autonomousTransition: "idle",
				});
			})
			.mapErr(rollbackAutonomous);
	}

	/**
	 * Set a configuration option for a session.
	 */
	setConfigOption(sessionId: string, configId: string, value: string): ResultAsync<void, AppError> {
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const hotState = this.stateReader.getHotState(sessionId);
		if (!canSendFromCanonicalOrCompatibility(this.stateReader, sessionId, hotState.isConnected)) {
			return errAsync(new ConnectionError(sessionId));
		}

		logger.debug("Setting config option", { sessionId, configId, value });

		return api
			.setConfigOption(session.id, configId, value)
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
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const hotState = this.stateReader.getHotState(sessionId);
		if (!canSendFromCanonicalOrCompatibility(this.stateReader, sessionId, hotState.isConnected)) {
			return errAsync(new ConnectionError(sessionId));
		}

		return api
			.stopStreaming(session.id)
			.map(() => {
				// Transition machine STREAMING → READY so deriveSessionRuntimeState()
				// sees the updated connection state after the reactive anchor fires.
				this.connectionManager.sendResponseComplete(sessionId);
				this.hotStateManager.updateHotState(sessionId, {
					status: "ready",
					turnState: "interrupted",
				});
				logger.debug("Streaming cancelled", { sessionId });
				return undefined;
			})
			.mapErr((error) => {
				logger.error("Failed to cancel streaming", { sessionId, error });
				return new AgentError("cancelStreaming", error instanceof Error ? error : undefined);
			});
	}
}
