import type { ResultAsync } from "neverthrow";
import { createLogger } from "$lib/acp/utils/logger.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { opencodeClient } from "../client.js";
import type { ModelMetadata, Provider } from "../types/index.js";

// Settings keys for SQLite storage
const FAVORITE_MODELS_KEY = "favorite_models";
const RECENT_MODELS_KEY = "recent_models";

// Type for persisted model references
interface ModelReference {
	providerId: string;
	modelId: string;
}

const logger = createLogger({ id: "provider-store", name: "Provider Store" });

// State using Svelte 5 runes
let providers = $state<Provider[]>([]);
let currentProviderId = $state<string>("");
let currentModelId = $state<string>("");
let currentVariant = $state<string | undefined>(undefined);
let isLoading = $state(false);
let isInitialized = $state(false);
const modelsMetadata = $state<Map<string, ModelMetadata>>(new Map());

// Favorites and recents (persisted to SQLite)
let favoriteModels = $state<ModelReference[]>([]);
let recentModels = $state<ModelReference[]>([]);

// Derived state
const currentProvider = $derived(providers.find((p) => p.id === currentProviderId));

const currentModel = $derived(currentProvider?.models.find((m) => m.id === currentModelId));

// Actions
function loadProviders(): ResultAsync<void, Error> {
	isLoading = true;

	return opencodeClient
		.getProviders()
		.map((response) => {
			providers = response.providers;

			// Set defaults if not already set
			if (!currentProviderId && providers.length > 0) {
				const defaultProviderName = response.default?.provider;
				const defaultModelId = response.default?.model;
				const firstProvider = providers[0];

				// Find the provider to use (default or first)
				const providerToUse = defaultProviderName
					? (providers.find((p) => p.id === defaultProviderName) ?? firstProvider)
					: firstProvider;

				currentProviderId = providerToUse.id;

				// Use the configured default model if it exists in the provider's models
				// Otherwise fall back to first model
				if (defaultModelId && providerToUse.models.some((m) => m.id === defaultModelId)) {
					currentModelId = defaultModelId;
				} else {
					currentModelId = providerToUse.models[0]?.id ?? "";
				}
			}

			isInitialized = true;
			logger.info("Providers loaded", { count: providers.length });
			isLoading = false;
		})
		.mapErr((e) => {
			logger.error("Failed to load providers", { error: e.message });
			isLoading = false;
			return e;
		});
}

function setProvider(providerId: string): void {
	const provider = providers.find((p) => p.id === providerId);
	if (!provider) return;

	currentProviderId = providerId;
	currentModelId = provider.models[0]?.id ?? "";
	currentVariant = undefined;
}

function setModel(modelId: string): void {
	currentModelId = modelId;
	addRecentModel(currentProviderId, modelId);
}

function toggleFavoriteModel(providerId: string, modelId: string): void {
	const index = favoriteModels.findIndex(
		(f) => f.providerId === providerId && f.modelId === modelId
	);

	if (index >= 0) {
		favoriteModels = favoriteModels.filter((_, i) => i !== index);
	} else {
		favoriteModels = [{ providerId, modelId }, ...favoriteModels];
	}

	persistFavorites();
}

function addRecentModel(providerId: string, modelId: string): void {
	const filtered = recentModels.filter(
		(m) => !(m.providerId === providerId && m.modelId === modelId)
	);
	recentModels = [{ providerId, modelId }, ...filtered].slice(0, 5);
	persistRecents();
}

function isFavoriteModel(providerId: string, modelId: string): boolean {
	return favoriteModels.some((f) => f.providerId === providerId && f.modelId === modelId);
}

// Persistence helpers - using SQLite via Tauri commands
function persistFavorites(): void {
	tauriClient.settings.set<ModelReference[]>(FAVORITE_MODELS_KEY, favoriteModels).mapErr((err) => {
		logger.error("Failed to persist favorite models", { error: err.message });
	});
}

function persistRecents(): void {
	tauriClient.settings.set<ModelReference[]>(RECENT_MODELS_KEY, recentModels).mapErr((err) => {
		logger.error("Failed to persist recent models", { error: err.message });
	});
}

function loadPersistedState(): void {
	// Load favorites from SQLite
	tauriClient.settings
		.get<ModelReference[]>(FAVORITE_MODELS_KEY)
		.map((persisted) => {
			if (persisted && Array.isArray(persisted)) {
				favoriteModels = persisted;
			}
		})
		.mapErr((err) => {
			logger.error("Failed to load favorite models", { error: err.message });
		});

	// Load recents from SQLite
	tauriClient.settings
		.get<ModelReference[]>(RECENT_MODELS_KEY)
		.map((persisted) => {
			if (persisted && Array.isArray(persisted)) {
				recentModels = persisted;
			}
		})
		.mapErr((err) => {
			logger.error("Failed to load recent models", { error: err.message });
		});
}

// Export store
export function getProviderStore() {
	return {
		// State (readonly)
		get providers() {
			return providers;
		},
		get currentProviderId() {
			return currentProviderId;
		},
		get currentModelId() {
			return currentModelId;
		},
		get currentVariant() {
			return currentVariant;
		},
		get currentProvider() {
			return currentProvider;
		},
		get currentModel() {
			return currentModel;
		},
		get isLoading() {
			return isLoading;
		},
		get isInitialized() {
			return isInitialized;
		},
		get favoriteModels() {
			return favoriteModels;
		},
		get recentModels() {
			return recentModels;
		},
		get modelsMetadata() {
			return modelsMetadata;
		},

		// Actions
		loadProviders,
		setProvider,
		setModel,
		toggleFavoriteModel,
		addRecentModel,
		isFavoriteModel,
		loadPersistedState,
	};
}
