/**
 * Agent Model Preferences Store
 *
 * Module-level store (not context-based) for managing:
 * - Default models per agent per provider scope
 * - Favorite models per agent
 * - Cached available models per agent (for settings and optimistic display)
 * - Cached available modes per agent (for optimistic display)
 * - Per-session model memory (which model was used per mode in each session)
 *
 * All data is persisted to SQLite via tauriClient.settings
 */

import { okAsync, ResultAsync } from "neverthrow";
import { tauriClient } from "$lib/utils/tauri-client.js";
import {
	type ModelsForDisplay,
	type ProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type { Mode } from "../application/dto/mode.js";
import type { Model } from "../application/dto/model.js";
import type { AppError } from "../errors/app-error.js";
import type { SessionModelPerMode } from "../types/agent-model-preferences.js";

import { createLogger } from "../utils/logger.js";

const logger = createLogger({
	id: "agent-model-preferences-store",
	name: "Agent Model Preferences Store",
});

// SQLite storage keys
const AGENT_FAVORITE_MODELS_KEY = "agent_favorite_models";
const AGENT_DEFAULT_MODELS_KEY = "agent_default_models";
const AGENT_MODEL_PROVIDER_KEY = "agent_model_provider";
const AGENT_AVAILABLE_MODELS_CACHE_KEY = "agent_available_models_cache";
const AGENT_AVAILABLE_MODELS_DISPLAY_CACHE_KEY = "agent_available_models_display_cache";
const AGENT_PROVIDER_METADATA_CACHE_KEY = "agent_provider_metadata_cache";
const AGENT_AVAILABLE_MODES_CACHE_KEY = "agent_available_modes_cache";
const SESSION_MODEL_PER_MODE_KEY = "session_model_per_mode";
const PR_GENERATION_PREFS_KEY = "pr_generation_preferences";

/** Global preferences for PR content generation (agent + model + custom prompt). */
export interface PrGenerationPreferences {
	agentId?: string;
	modelId?: string;
	/** User-provided instructions layered ahead of the hidden response contract and diff context. */
	customPrompt?: string;
}

// State using Svelte 5 runes
const AGENT_DEFAULT_MODEL_SCOPE = "__agent__";

type AgentDefaultModels = Record<string, Record<string, string>>;

let favorites = $state<Record<string, string[]>>({});
let defaultModels = $state<AgentDefaultModels>({});
let modelProviderByAgent = $state<Record<string, string>>({});
let availableModelsCache = $state<Record<string, Model[]>>({});
let availableModelsDisplayCache = $state<Record<string, ModelsForDisplay>>({});
let availableProviderMetadataCache = $state<Record<string, ProviderMetadataProjection>>({});
let availableModesCache = $state<Record<string, Mode[]>>({});
let sessionModelPerMode = $state<SessionModelPerMode>({});
let prGenerationPrefs = $state<PrGenerationPreferences>({});
let loadPromise: ResultAsync<void, AppError> | null = null;
let sessionModelLoadState = $state<"unloaded" | "loading" | "loaded" | "failed">("unloaded");
let cacheLoaded = $state(false);

const logger_instance = logger;

// ============================================
// PUBLIC API
// ============================================

/**
 * Get favorite models for a specific agent.
 */
export function getFavorites(agentId: string): string[] {
	return favorites[agentId] ?? [];
}

/**
 * Check if a model is favorited for a specific agent.
 */
export function isFavorite(agentId: string, modelId: string): boolean {
	return getFavorites(agentId).includes(modelId);
}

/**
 * Toggle a model as favorite for a specific agent.
 */
export function toggleFavorite(agentId: string, modelId: string): void {
	if (!favorites[agentId]) {
		favorites[agentId] = [];
	}

	const index = favorites[agentId].indexOf(modelId);
	if (index >= 0) {
		// Remove from favorites
		favorites[agentId] = favorites[agentId].filter((_, i) => i !== index);
	} else {
		// Add to favorites (newest first)
		favorites[agentId] = [modelId, ...favorites[agentId]];
	}

	persistFavorites();
}

function getDefaultModelScopeKey(providerId: string | null | undefined): string {
	return providerId && providerId.length > 0 ? providerId : AGENT_DEFAULT_MODEL_SCOPE;
}

export function getDefaultModel(agentId: string, providerId: string | null | undefined): string | null {
	const scopeKey = getDefaultModelScopeKey(providerId);
	return defaultModels[agentId]?.[scopeKey] ?? null;
}

export function isDefaultModel(
	agentId: string,
	providerId: string | null | undefined,
	modelId: string
): boolean {
	return getDefaultModel(agentId, providerId) === modelId;
}

export function setDefaultModel(
	agentId: string,
	providerId: string | null | undefined,
	modelId: string | null
): void {
	const scopeKey = getDefaultModelScopeKey(providerId);

	if (!defaultModels[agentId]) {
		defaultModels[agentId] = {};
	}

	if (modelId === null) {
		delete defaultModels[agentId][scopeKey];
		if (Object.keys(defaultModels[agentId]).length === 0) {
			delete defaultModels[agentId];
		}
	} else {
		defaultModels[agentId][scopeKey] = modelId;
	}

	persistDefaultModels();
}

export function getModelProvider(agentId: string): string | null {
	return modelProviderByAgent[agentId] ?? null;
}

export function setModelProvider(agentId: string, providerId: string): void {
	modelProviderByAgent[agentId] = providerId;
	persistModelProviders();
}

/**
 * Get cached available models for a specific agent.
 * Used for displaying model options in settings and optimistic display.
 */
export function getCachedModels(agentId: string): Model[] {
	return availableModelsCache[agentId] ?? [];
}

/**
 * Update the cached available models for a specific agent.
 * Called when a session connects to cache the available models.
 */
export function updateModelsCache(agentId: string, models: Model[]): void {
	availableModelsCache[agentId] = models;
	persistModelsCache();
}

/**
 * Get cached display-ready model groups for a specific agent.
 */
export function getCachedModelsDisplay(agentId: string): ModelsForDisplay | null {
	return availableModelsDisplayCache[agentId] ?? null;
}

export function getCachedProviderMetadata(agentId: string): ProviderMetadataProjection | null {
	return availableProviderMetadataCache[agentId] ?? null;
}

/**
 * Update cached display-ready model groups for a specific agent.
 * Called when a session connects and backend provides modelsDisplay.
 */
export function updateModelsDisplayCache(
	agentId: string,
	modelsDisplay: ModelsForDisplay | undefined
): void {
	if (modelsDisplay) {
		availableModelsDisplayCache[agentId] = modelsDisplay;
	} else {
		delete availableModelsDisplayCache[agentId];
	}
	persistModelsDisplayCache();
}

export function updateProviderMetadataCache(
	agentId: string,
	providerMetadata: ProviderMetadataProjection | undefined
): void {
	if (providerMetadata) {
		availableProviderMetadataCache[agentId] = providerMetadata;
	} else {
		delete availableProviderMetadataCache[agentId];
	}

	persistProviderMetadataCache();
}

/**
 * Get cached available modes for a specific agent.
 * Used for optimistic display of mode selector before session connects.
 */
export function getCachedModes(agentId: string): Mode[] {
	return availableModesCache[agentId] ?? [];
}

/**
 * Update the cached available modes for a specific agent.
 * Called when a session connects to cache the available modes.
 */
export function updateModesCache(agentId: string, modes: Mode[]): void {
	availableModesCache[agentId] = modes;
	persistModesCache();
}

/**
 * Get the model choice for a specific session and mode.
 * Returns undefined if no model has been selected for this mode in this session.
 */
export function getSessionModelForMode(sessionId: string, modeId: string): string | undefined {
	return sessionModelPerMode[sessionId]?.[modeId];
}

/**
 * Set the model choice for a specific session and mode.
 * Called when user changes model or mode switch occurs.
 */
export function setSessionModelForMode(sessionId: string, modeId: string, modelId: string): void {
	if (!sessionModelPerMode[sessionId]) {
		sessionModelPerMode[sessionId] = {};
	}
	sessionModelPerMode[sessionId][modeId] = modelId;
	persistSessionModelPerMode();
}

/**
 * Clear all model choices for a specific session.
 * Called when session is removed/deleted.
 */
export function clearSessionModelPerMode(sessionId: string): void {
	delete sessionModelPerMode[sessionId];
	persistSessionModelPerMode();
}

// ============================================
// PR GENERATION PREFERENCES
// ============================================

/**
 * Get the global PR generation preferences (agent + model override).
 */
export function getPrGenerationPrefs(): PrGenerationPreferences {
	return prGenerationPrefs;
}

/**
 * Update the global PR generation preferences.
 * Pass partial to merge, or empty object to clear.
 */
export function setPrGenerationPrefs(prefs: PrGenerationPreferences): void {
	prGenerationPrefs = prefs;
	persistPrGenerationPrefs();
}

export function isSessionModelLoaded(): boolean {
	return sessionModelLoadState === "loaded";
}

/**
 * Whether the persisted mode/model caches have been loaded from SQLite.
 * Used by sessionless AgentInput to distinguish "loading" from "genuinely empty".
 *
 * NOTE: Reads `$state` — this file MUST remain `.svelte.ts` for reactivity to work.
 */
export function isCacheLoaded(): boolean {
	return cacheLoaded;
}

/**
 * Load all persisted preferences from SQLite.
 * Called once on app startup.
 */
export function loadPersistedState(): ResultAsync<void, AppError> {
	if (loadPromise) {
		return loadPromise;
	}

	sessionModelLoadState = "loading";

	const favoritesLoad = tauriClient.settings
		.get<Record<string, string[]>>(AGENT_FAVORITE_MODELS_KEY)
		.map((persisted) => {
			if (persisted && typeof persisted === "object") {
				favorites = persisted;
				logger_instance.debug("Loaded agent favorite models", {
					agents: Object.keys(persisted).length,
				});
			}
			return undefined;
		})
		.mapErr((err) => {
			logger_instance.debug("No persisted favorite models found (expected on first run)", {
				error: err.message,
			});
			return err;
		})
		.orElse(() => okAsync(undefined));

	const defaultModelsLoad = tauriClient.settings
		.get<AgentDefaultModels>(AGENT_DEFAULT_MODELS_KEY)
		.map((persisted) => {
			if (persisted && typeof persisted === "object") {
				defaultModels = persisted;
				logger_instance.debug("Loaded agent default models", {
					agents: Object.keys(persisted).length,
				});
			}
			return undefined;
		})
		.mapErr((err) => {
			logger_instance.debug("No persisted default models found (expected on first run)", {
				error: err.message,
			});
			return err;
		})
		.orElse(() => okAsync(undefined));

	const modelsCacheLoad = tauriClient.settings
		.get<Record<string, Model[]>>(AGENT_AVAILABLE_MODELS_CACHE_KEY)
		.map((persisted) => {
			if (persisted && typeof persisted === "object") {
				availableModelsCache = persisted;
				logger_instance.debug("Loaded cached available models", {
					agents: Object.keys(persisted).length,
				});
			}
			return undefined;
		})
		.mapErr((err) => {
			logger_instance.debug("No cached models found (expected on first run)", {
				error: err.message,
			});
			return err;
		})
		.orElse(() => okAsync(undefined));

	const modelProvidersLoad = tauriClient.settings
		.get<Record<string, string>>(AGENT_MODEL_PROVIDER_KEY)
		.map((persisted) => {
			if (persisted && typeof persisted === "object") modelProviderByAgent = persisted;
			return undefined;
		})
		.orElse(() => okAsync(undefined));

	const modesCacheLoad = tauriClient.settings
		.get<Record<string, Mode[]>>(AGENT_AVAILABLE_MODES_CACHE_KEY)
		.map((persisted) => {
			if (persisted && typeof persisted === "object") {
				availableModesCache = persisted;
				logger_instance.debug("Loaded cached available modes", {
					agents: Object.keys(persisted).length,
				});
			}
			return undefined;
		})
		.mapErr((err) => {
			logger_instance.debug("No cached modes found (expected on first run)", {
				error: err.message,
			});
			return err;
		})
		.orElse(() => okAsync(undefined));

	const providerMetadataCacheLoad = tauriClient.settings
		.get<Record<string, ProviderMetadataProjection>>(AGENT_PROVIDER_METADATA_CACHE_KEY)
		.map((persisted) => {
			if (persisted && typeof persisted === "object") {
				availableProviderMetadataCache = persisted;
				logger_instance.debug("Loaded cached provider metadata", {
					agents: Object.keys(persisted).length,
				});
			}
			return undefined;
		})
		.mapErr((err) => {
			logger_instance.debug("No cached provider metadata found (expected on first run)", {
				error: err.message,
			});
			return err;
		})
		.orElse(() => okAsync(undefined));

	const modelsDisplayCacheLoad = tauriClient.settings
		.get<Record<string, ModelsForDisplay>>(AGENT_AVAILABLE_MODELS_DISPLAY_CACHE_KEY)
		.map((persisted) => {
			if (persisted && typeof persisted === "object") {
				availableModelsDisplayCache = persisted;
				logger_instance.debug("Loaded cached available models display", {
					agents: Object.keys(persisted).length,
				});
			}
			return undefined;
		})
		.mapErr((err) => {
			logger_instance.debug("No cached models display found (expected on first run)", {
				error: err.message,
			});
			return err;
		})
		.orElse(() => okAsync(undefined));

	const prGenerationPrefsLoad = tauriClient.settings
		.get<PrGenerationPreferences>(PR_GENERATION_PREFS_KEY)
		.map((persisted) => {
			if (persisted && typeof persisted === "object") {
				prGenerationPrefs = persisted;
				logger_instance.debug("Loaded PR generation preferences", persisted);
			}
			return undefined;
		})
		.mapErr((err) => {
			logger_instance.debug("No PR generation preferences found (expected on first run)", {
				error: err.message,
			});
			return err;
		})
		.orElse(() => okAsync(undefined));

	const sessionModelsLoad = tauriClient.settings
		.get<SessionModelPerMode>(SESSION_MODEL_PER_MODE_KEY)
		.map((persisted) => {
			sessionModelLoadState = "loaded";
			if (persisted && typeof persisted === "object") {
				sessionModelPerMode = persisted;
				logger_instance.debug("Loaded session model per mode", {
					sessions: Object.keys(persisted).length,
				});
			}
			return undefined;
		})
		.mapErr((err) => {
			sessionModelLoadState = "failed";
			logger_instance.debug("No session model memory found (expected on first run)", {
				error: err.message,
			});
			return err;
		})
		.orElse(() => okAsync(undefined));

	loadPromise = ResultAsync.combine([
		favoritesLoad,
		defaultModelsLoad,
		modelProvidersLoad,
		modelsCacheLoad,
		providerMetadataCacheLoad,
		modelsDisplayCacheLoad,
		modesCacheLoad,
		sessionModelsLoad,
		prGenerationPrefsLoad,
	]).map(() => {
		cacheLoaded = true;
	});

	return loadPromise;
}

export function ensureLoaded(): ResultAsync<void, AppError> {
	return loadPersistedState();
}

// ============================================
// PRIVATE PERSISTENCE HELPERS
// ============================================

function persistProviderMetadataCache(): void {
	tauriClient.settings
		.set<Record<string, ProviderMetadataProjection>>(
			AGENT_PROVIDER_METADATA_CACHE_KEY,
			availableProviderMetadataCache
		)
		.mapErr((err) => {
			logger_instance.error("Failed to persist provider metadata cache", {
				error: err.message,
			});
		});
}

function persistFavorites(): void {
	tauriClient.settings
		.set<Record<string, string[]>>(AGENT_FAVORITE_MODELS_KEY, favorites)
		.mapErr((err) => {
			logger_instance.error("Failed to persist favorite models", { error: err.message });
		});
}

function persistDefaultModels(): void {
	tauriClient.settings
		.set<AgentDefaultModels>(AGENT_DEFAULT_MODELS_KEY, defaultModels)
		.mapErr((err) => {
			logger_instance.error("Failed to persist default models", { error: err.message });
		});
}

function persistModelProviders(): void {
	tauriClient.settings
		.set<Record<string, string>>(AGENT_MODEL_PROVIDER_KEY, modelProviderByAgent)
		.mapErr((err) => {
			logger_instance.error("Failed to persist model provider", { error: err.message });
		});
}

function persistModelsCache(): void {
	tauriClient.settings
		.set<Record<string, Model[]>>(AGENT_AVAILABLE_MODELS_CACHE_KEY, availableModelsCache)
		.mapErr((err) => {
			logger_instance.error("Failed to persist models cache", { error: err.message });
		});
}

function persistModelsDisplayCache(): void {
	tauriClient.settings
		.set<Record<string, ModelsForDisplay>>(
			AGENT_AVAILABLE_MODELS_DISPLAY_CACHE_KEY,
			availableModelsDisplayCache
		)
		.mapErr((err) => {
			logger_instance.error("Failed to persist models display cache", { error: err.message });
		});
}

function persistModesCache(): void {
	tauriClient.settings
		.set<Record<string, Mode[]>>(AGENT_AVAILABLE_MODES_CACHE_KEY, availableModesCache)
		.mapErr((err) => {
			logger_instance.error("Failed to persist modes cache", { error: err.message });
		});
}

function persistSessionModelPerMode(): void {
	tauriClient.settings
		.set<SessionModelPerMode>(SESSION_MODEL_PER_MODE_KEY, sessionModelPerMode)
		.mapErr((err) => {
			logger_instance.error("Failed to persist session model per mode", { error: err.message });
		});
}

function persistPrGenerationPrefs(): void {
	tauriClient.settings
		.set<PrGenerationPreferences>(PR_GENERATION_PREFS_KEY, prGenerationPrefs)
		.mapErr((err) => {
			logger_instance.error("Failed to persist PR generation preferences", { error: err.message });
		});
}
