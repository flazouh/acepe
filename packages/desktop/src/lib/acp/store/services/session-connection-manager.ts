/**
 * Session Connection Manager - Handles session connection lifecycle.
 *
 * Responsibilities:
 * - Session creation (new sessions)
 * - Session connection (resume existing sessions)
 * - Session disconnection
 * - Model/mode switching with optimistic updates
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
import type { SessionModelState as AcpSessionModelState } from "../../../services/acp-types.js";
import { tauriClient } from "../../../utils/tauri-client.js";
import type { AppError } from "../../errors/app-error.js";
import { AgentError, ConnectionError, SessionNotFoundError } from "../../errors/app-error.js";
import type { ModeType } from "../../types/agent-model-preferences.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { createLogger } from "../../utils/logger.js";
import * as preferencesStore from "../agent-model-preferences-store.svelte.js";
import { api } from "../api.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import type { SessionEventService } from "../session-event-service.svelte.js";
import type { Mode, Model, SessionCold } from "../types.js";
import type {
	ICapabilitiesManager,
	IConnectionManager,
	IEntryManager,
	IHotStateManager,
	ISessionStateReader,
	ISessionStateWriter,
} from "./interfaces/index.js";

const logger = createLogger({ id: "session-connection-manager", name: "SessionConnectionManager" });

/**
 * Frontend connection timeout (ms).
 * Defense-in-depth: the Rust side has SESSION_CLIENT_OPERATION_TIMEOUT (30s),
 * but if that fails to fire, this ensures the UI doesn't hang forever.
 */
const CONNECTION_TIMEOUT_MS = 15_000;

interface ConnectSessionOptions {
	agentOverrideId?: string;
}

type ProviderAwareSessionModelState = AcpSessionModelState & {
	readonly providerMetadata?: ProviderMetadataProjection | null;
	readonly modelsDisplay?: ModelsForDisplay | null;
};

/**
 * Wrap a ResultAsync with a timeout. If the timeout fires first, the
 * returned ResultAsync resolves to the given timeoutError.
 */
function withTimeout<T, E>(ra: ResultAsync<T, E>, ms: number, timeoutError: E): ResultAsync<T, E> {
	return ResultAsync.fromPromise(
		Promise.race([
			ra.match(
				(value) => ({ ok: true as const, value }),
				(error) => ({ ok: false as const, error })
			),
			new Promise<{ ok: false; error: E }>((resolve) =>
				setTimeout(() => resolve({ ok: false, error: timeoutError }), ms)
			),
		]).then((result) => {
			if (result.ok) return result.value;
			throw result.error;
		}),
		(error) => error as E
	);
}

function getProviderAwareSessionModelState(
	modelState: AcpSessionModelState | null | undefined
): ProviderAwareSessionModelState {
	if (!modelState) {
		return {};
	}

	return modelState as ProviderAwareSessionModelState;
}

/**
 * Manager for session connection lifecycle operations.
 */
export class SessionConnectionManager {
	// Cache in-flight connection ResultAsync per session.
	// Concurrent callers get the same Promise — no duplicate API calls.
	private pendingConnections = new Map<string, ResultAsync<SessionCold, AppError>>();

	// Sequence counter for config option changes — newest call wins on concurrent mutations.
	private configOptionSeq = new Map<string, number>();

	constructor(
		private readonly stateReader: ISessionStateReader,
		private readonly stateWriter: ISessionStateWriter,
		private readonly hotStateManager: IHotStateManager,
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

	private setSessionAutonomous(
		sessionId: string,
		enabled: boolean
	): ResultAsync<void, AppError> {
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
	 * Create a new session and connect to ACP.
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
		},
		eventHandler: SessionEventHandler
	): ResultAsync<SessionCold, AppError> {
		const sessionCwd = options.worktreePath ? options.worktreePath : options.projectPath;
		logger.info("[first-send-trace] connection manager createSession", {
			projectPath: options.projectPath,
			worktreePath: options.worktreePath ? options.worktreePath : null,
			sessionCwd,
			agentId: options.agentId,
		});
		return api
			.newSession(sessionCwd, options.agentId)
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
							// initializeHotState writes synchronously (bypasses RAF batch),
							// so the event service will see isConnected: true immediately
							// when it receives streaming events for this session.
							this.hotStateManager.initializeHotState(sessionId, {
								status: "ready",
								isConnected: true,
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

							// Initialize session machine with correct initial states:
							// - Content: LOADED (new session has no entries to load)
							// - Connection: READY (already connected via newSession API)
							this.connectionManager.initializeConnectedSession(sessionId);

							// Flush any pending events that arrived before session was added
							this.eventService.flushPendingEvents(sessionId, eventHandler);

							logger.debug("Session created and connected", {
								sessionId,
							});

							return sessionCold;
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
		if (hotState.isConnected) {
			logger.debug("Session already connected, skipping", {
				sessionId,
				status: hotState.status,
				isConnected: hotState.isConnected,
			});
			return okAsync(session);
		}
		// Defensive guard: if we already have a bound ACP session ID for this thread,
		// treat it as connected instead of issuing another resume call (which can replay history).
		if (hotState.acpSessionId === sessionId && hotState.status !== "error") {
			logger.warn(
				"Session has bound ACP session ID while disconnected; skipping duplicate resume",
				{
					sessionId,
					status: hotState.status,
				}
			);
			this.hotStateManager.updateHotState(sessionId, {
				isConnected: true,
				status: hotState.status === "idle" ? "ready" : hotState.status,
				connectionError: null,
			});
			return okAsync(session);
		}

		const pending = this.pendingConnections.get(sessionId);
		if (pending) {
			logger.debug("Connection already in flight, returning pending", { sessionId });
			return pending;
		}

		this.connectionManager.setConnecting(sessionId, true);
		const shouldSuppressReplay = this.stateReader.isPreloaded(sessionId);
		if (shouldSuppressReplay) {
			this.eventService.suppressReplayForSession(sessionId);
		} else {
			this.eventService.clearReplaySuppressionForSession(sessionId);
		}

		// Start connection in state machine
		this.connectionManager.sendConnectionConnect(sessionId);

		this.hotStateManager.updateHotState(sessionId, {
			status: "connecting",
			connectionError: null,
		});

		// Always send projectPath as the base CWD. The backend will override it
		// with the descriptor's worktree path when it still exists on disk, avoiding
		// the case where the frontend sends stale workspace metadata back as resume
		// authority.
		const resumeCwd = session.projectPath;
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
			.andThen(() => {
				const reconnectHotState = this.stateReader.getHotState(sessionId);
				const shouldRestoreAutonomous = reconnectHotState.autonomousEnabled;

				return withTimeout(
					api.resumeSession(sessionId, resumeCwd, options?.agentOverrideId),
					CONNECTION_TIMEOUT_MS,
					new ConnectionError(`Session connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`)
				)
					.andThen((result) => preferencesStore.ensureLoaded().map(() => result))
					.andThen((result) => {
						this.connectionManager.setConnecting(sessionId, false);
						const modelState = getProviderAwareSessionModelState(result.models);
						const {
							availableModels: rawModels = [],
							currentModelId,
							modelsDisplay: rawModelsDisplay,
							providerMetadata: rawProviderMetadata,
						} = modelState;
						const providerMetadata = this.resolveProviderMetadata(
							effectiveAgentId,
							rawProviderMetadata
						);
						const modelsDisplay =
							normalizeModelsForDisplay(
								effectiveAgentId,
								rawModelsDisplay,
								effectiveAgentId,
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

						const currentMode =
							availableModes.find((m) => m.id === result.modes?.currentModeId) ?? null;
						const initialModel = this.resolveCurrentModel(
							effectiveAgentId,
							availableModels,
							currentModelId,
							modelsDisplay,
							providerMetadata
						);

						const storedModelId = currentMode?.id
							? preferencesStore.getSessionModelForMode(sessionId, currentMode.id)
							: undefined;
						const hasStoredModel = typeof storedModelId === "string" && storedModelId.length > 0;
						const storedModelValid =
							hasStoredModel && availableModels.some((m) => m.id === storedModelId);
						const canSeedSessionModel = preferencesStore.isSessionModelLoaded();

						if (storedModelValid && storedModelId && storedModelId !== initialModel?.id) {
							const storedModel = availableModels.find((m) => m.id === storedModelId) ?? null;
							logger.debug("Restoring stored session model for mode", {
								sessionId,
								modeId: currentMode?.id,
								modelId: storedModelId,
							});
							return withTimeout(
								api.setModel(sessionId, storedModelId),
								CONNECTION_TIMEOUT_MS,
								new ConnectionError(`setModel timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`)
							)
								.map(() => ({
									availableModes,
									availableModels,
									availableCommands,
									configOptions,
									modelsDisplay: modelsDisplay,
									providerMetadata,
									currentMode,
									currentModel: storedModel ?? initialModel,
								}))
								.mapErr((err) => {
									logger.warn("Failed to restore session model", {
										sessionId,
										modelId: storedModelId,
										error: err,
									});
									return err;
								})
								.orElse(() =>
									okAsync({
										availableModes,
										availableModels,
										availableCommands,
										configOptions,
										modelsDisplay: modelsDisplay,
										providerMetadata,
										currentMode,
										currentModel: initialModel,
									})
								);
						}

						if (!hasStoredModel && canSeedSessionModel && currentMode && initialModel?.id) {
							preferencesStore.setSessionModelForMode(sessionId, currentMode.id, initialModel.id);
						}

						return okAsync({
							availableModes,
							availableModels,
							availableCommands,
							configOptions,
							modelsDisplay: modelsDisplay,
							providerMetadata,
							currentMode,
							currentModel: initialModel,
						});
					})
					.andThen(
						({
							availableModes,
							availableModels,
							availableCommands,
							configOptions,
							modelsDisplay,
							providerMetadata,
							currentMode,
							currentModel,
						}) => {
							const supportsAutonomous = this.supportsAutonomousMode(
								currentMode ? currentMode.id : undefined
							);
							if (!shouldRestoreAutonomous) {
								return okAsync({
									availableModes,
									availableModels,
									availableCommands,
									configOptions,
									modelsDisplay,
									providerMetadata,
									currentMode,
									currentModel,
									autonomousEnabled: false,
								});
							}

							if (!supportsAutonomous) {
								return this.setSessionAutonomous(session.id, false)
									.orElse((error) => {
										logger.warn(
											"Failed to clear Autonomous while reconnecting into unsupported mode",
											{
												sessionId,
												modeId: currentMode ? currentMode.id : null,
												error,
											}
										);
										return okAsync(undefined);
									})
									.map(() => ({
										availableModes,
										availableModels,
										availableCommands,
										configOptions,
										modelsDisplay,
										providerMetadata,
										currentMode,
										currentModel,
										autonomousEnabled: false,
									}));
							}

							return this.setSessionAutonomous(session.id, true)
								.map(() => ({
									availableModes,
									availableModels,
									availableCommands,
									configOptions,
									modelsDisplay,
									providerMetadata,
									currentMode,
									currentModel,
									autonomousEnabled: true,
								}))
								.orElse((error) => {
									logger.warn("Failed to restore Autonomous on connect; continuing safely", {
										sessionId,
										modeId: currentMode ? currentMode.id : null,
										error,
									});
									return okAsync({
										availableModes,
										availableModels,
										availableCommands,
										configOptions,
										modelsDisplay,
										providerMetadata,
										currentMode,
										currentModel,
										autonomousEnabled: false,
									});
								});
						}
					);
			})
			.map(
				({
					availableModes,
					availableModels,
					availableCommands,
					configOptions,
					modelsDisplay,
					providerMetadata,
					currentMode,
					currentModel,
					autonomousEnabled,
				}) => {
					// Cache available models and modes for settings/optimistic display
					preferencesStore.updateModelsCache(effectiveAgentId, availableModels);
					preferencesStore.updateProviderMetadataCache(effectiveAgentId, providerMetadata);
					preferencesStore.updateModelsDisplayCache(
						effectiveAgentId,
						modelsDisplay,
						providerMetadata
					);
					preferencesStore.updateModesCache(effectiveAgentId, availableModes);
					logger.info("Provider model capabilities on session resume", {
						sessionId,
						agentId: effectiveAgentId,
						availableModelIds: availableModels.map((model) => model.id),
						currentModelId: currentModel?.id ?? null,
						cachedModelIds: preferencesStore
							.getCachedModels(effectiveAgentId)
							.map((model) => model.id),
					});

					// Store capabilities separately from cold data
					this.capabilitiesManager.updateCapabilities(sessionId, {
						availableModes,
						availableModels,
						availableCommands,
						modelsDisplay,
						providerMetadata,
					});

					this.pendingConnections.delete(sessionId);

					// Update state machine: connecting → success → warming up → capabilities loaded
					this.connectionManager.sendConnectionSuccess(sessionId);
					this.connectionManager.sendCapabilitiesLoaded(sessionId);

					// Transition content state to LOADED so the UI shows the conversation.
					// For Codex, content arrives via ACP streaming; for disk-based agents,
					// content may already be LOADED from preloadSessions (idempotent).
					this.connectionManager.sendContentLoad(sessionId);
					this.connectionManager.sendContentLoaded(sessionId);

					this.hotStateManager.updateHotState(sessionId, {
						status: "ready",
						turnState: "idle",
						isConnected: true,
						acpSessionId: sessionId,
						autonomousEnabled,
						autonomousTransition: "idle",
						currentMode,
						currentModel,
						availableCommands,
						configOptions,
						connectionError: null,
					});

					// Resume can emit events before connect finishes. Flush buffered events now.
					this.eventService.flushPendingEvents(sessionId, eventHandler);

					return this.stateReader.getSessionCold(sessionId)!;
				}
			)
			.mapErr((error) => {
				this.pendingConnections.delete(sessionId);
				this.connectionManager.setConnecting(sessionId, false);
				this.eventService.clearReplaySuppressionForSession(sessionId);

				const errorMessage = error instanceof Error ? error.message : String(error);
				const isMethodNotFound =
					errorMessage.includes("Method not found") || errorMessage.includes("-32601");

				// Connection failed in state machine
				this.connectionManager.sendConnectionError(sessionId);

				if (isMethodNotFound) {
					logger.debug("Agent does not support session resume, session is read-only", {
						sessionId,
						agentId: session.agentId,
					});
					this.hotStateManager.updateHotState(sessionId, {
						status: "idle",
						isConnected: false,
						availableCommands: [],
						connectionError: "Session is read-only (agent does not support resume)",
					});
					return new ConnectionError(
						`Session is read-only (agent does not support resume)`,
						error instanceof Error ? error : undefined
					);
				}

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
		this.eventService.clearReplaySuppressionForSession(sessionId);

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
	 * Set model for a session (optimistic update with rollback).
	 * Also tracks the model choice per mode for this session.
	 */
	setModel(sessionId: string, modelId: string): ResultAsync<void, AppError> {
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const hotState = this.stateReader.getHotState(sessionId);
		if (!hotState.isConnected) {
			return errAsync(new ConnectionError(sessionId));
		}

		const capabilities = this.capabilitiesManager.getCapabilities(sessionId);
		const newModel = capabilities.availableModels.find((m) => m.id === modelId);
		const oldModel = hotState.currentModel;

		this.hotStateManager.updateHotState(sessionId, { currentModel: newModel || null });
		logger.debug("Setting model (optimistic)", { sessionId, modelId });

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
				this.hotStateManager.updateHotState(sessionId, { currentModel: oldModel });
				logger.error("Failed to set model, rolling back", {
					sessionId,
					modelId,
					error,
				});
				return new AgentError("setModel", error instanceof Error ? error : undefined);
			});
	}

	/**
	 * Set mode for a session (optimistic update with rollback).
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
		if (!hotState.isConnected) {
			return errAsync(new ConnectionError(sessionId));
		}

		const capabilities = this.capabilitiesManager.getCapabilities(sessionId);
		const newMode = capabilities.availableModes.find((m) => m.id === modeId);
		const oldMode = hotState.currentMode;
		const oldAutonomousEnabled = hotState.autonomousEnabled;
		const nextAutonomousEnabled =
			oldAutonomousEnabled && this.supportsAutonomousMode(newMode ? newMode.id : undefined);
		this.hotStateManager.updateHotState(sessionId, {
			currentMode: newMode || null,
			autonomousEnabled: nextAutonomousEnabled,
		});
		logger.debug("Setting mode (optimistic)", { sessionId, modeId });

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
				this.hotStateManager.updateHotState(sessionId, {
					currentMode: oldMode,
					autonomousEnabled: oldAutonomousEnabled,
				});
				logger.error("Failed to set mode, rolling back", {
					sessionId,
					modeId,
					error,
				});
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
			enabled && this.supportsAutonomousMode(hotState.currentMode ? hotState.currentMode.id : undefined);
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

		if (!hotState.isConnected) {
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
	 * Set a configuration option for a session (optimistic update with response override).
	 */
	setConfigOption(sessionId: string, configId: string, value: string): ResultAsync<void, AppError> {
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const hotState = this.stateReader.getHotState(sessionId);
		if (!hotState.isConnected) {
			return errAsync(new ConnectionError(sessionId));
		}

		// Bump sequence — newest call wins on concurrent mutations
		const seq = (this.configOptionSeq.get(sessionId) ?? 0) + 1;
		this.configOptionSeq.set(sessionId, seq);

		// Optimistic: update just the changed option's currentValue
		const optimisticOptions = (hotState.configOptions ?? []).map((opt) =>
			opt.id === configId ? { ...opt, currentValue: value } : opt
		);
		this.hotStateManager.updateHotState(sessionId, { configOptions: optimisticOptions });
		logger.debug("Setting config option (optimistic)", { sessionId, configId, value });

		return api
			.setConfigOption(session.id, configId, value)
			.map((response) => {
				// Only apply if we are still the latest call
				if (this.configOptionSeq.get(sessionId) !== seq) return;

				// Replace with full state from response (other options may have changed)
				if (response?.configOptions && Array.isArray(response.configOptions)) {
					this.hotStateManager.updateHotState(sessionId, {
						configOptions: response.configOptions,
					});
				}
				logger.debug("Config option set successfully", { sessionId, configId });
			})
			.mapErr((error) => {
				// Only rollback if we are still the latest call
				if (this.configOptionSeq.get(sessionId) === seq) {
					this.hotStateManager.updateHotState(sessionId, {
						configOptions: hotState.configOptions ?? [],
					});
				}
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
		if (!hotState.isConnected) {
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
