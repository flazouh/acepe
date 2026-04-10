import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getContext, setContext } from "svelte";
import { toast } from "svelte-sonner";
import type {
	VoiceLanguageOption,
	VoiceModelDownloadProgress,
	VoiceModelInfo,
} from "$lib/acp/types/voice-input.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const STORE_KEY = Symbol("voice-settings");
const DEFAULT_MODEL_ID = "small.en";
const DEFAULT_LANGUAGE = "auto";
const logger = createLogger({
	id: "voice-settings",
	name: "VoiceSettingsStore",
});

const VOICE_ENABLED_KEY = "voice_enabled";
const VOICE_LANGUAGE_KEY = "voice_language";
const VOICE_MODEL_KEY = "voice_model";

function normalizeLanguageForModel(model: VoiceModelInfo | null, value: string): string {
	if (!model) {
		return value;
	}

	if (!model.is_english_only) {
		return "auto";
	}

	if (value === "auto" || value === "en") {
		return value;
	}

	return "auto";
}

interface VoiceDownloadCompletePayload {
	model_id: string;
}

interface VoiceDownloadErrorPayload {
	model_id: string;
	message: string;
}

export class VoiceSettingsStore {
	enabled = $state(true);
	selectedModelId = $state(DEFAULT_MODEL_ID);
	language = $state(DEFAULT_LANGUAGE);
	models = $state<VoiceModelInfo[]>([]);
	languages = $state<VoiceLanguageOption[]>([]);
	modelsLoading = $state(true);
	downloadProgressModelId = $state<string | null>(null);
	downloadPercent = $state(0);

	readonly selectedModel = $derived(
		this.models.find((model) => model.id === this.selectedModelId) ?? null
	);

	private initialized = false;
	private listenersRegistered = false;
	private readonly unlisteners: UnlistenFn[] = [];

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		await Promise.all([
			this.loadPersistedSettings(),
			this.refreshModels(),
			this.refreshLanguages(),
			this.registerListeners(),
		]);
		await this.normalizePersistedLanguage();
		await this.preloadSelectedModel();
		this.initialized = true;
	}

	dispose(): void {
		for (const unlisten of this.unlisteners.splice(0)) {
			unlisten();
		}
		this.initialized = false;
		this.listenersRegistered = false;
	}

	async setEnabled(value: boolean): Promise<void> {
		console.log("[voice-settings] setEnabled", { value });
		const result = await tauriClient.settings.set(VOICE_ENABLED_KEY, value);
		if (result.isErr()) {
			logger.error("Failed to persist voice enabled preference", { error: result.error });
			toast.error(result.error.message);
			return;
		}

		this.enabled = value;
		if (value) {
			await this.preloadSelectedModel();
		}
	}

	async setLanguage(value: string): Promise<void> {
		const nextLanguage = normalizeLanguageForModel(this.selectedModel, value);
		console.log("[voice-settings] setLanguage", {
			value,
			nextLanguage,
			selectedModelId: this.selectedModelId,
		});
		const result = await tauriClient.settings.set(VOICE_LANGUAGE_KEY, nextLanguage);
		if (result.isErr()) {
			logger.error("Failed to persist voice language preference", { error: result.error });
			toast.error(result.error.message);
			return;
		}

		this.language = nextLanguage;
	}

	async setSelectedModelId(modelId: string): Promise<void> {
		console.log("[voice-settings] setSelectedModelId", {
			modelId,
			previousModelId: this.selectedModelId,
		});
		const previousModelId = this.selectedModelId;
		const saveResult = await tauriClient.settings.set(VOICE_MODEL_KEY, modelId);
		if (saveResult.isErr()) {
			logger.error("Failed to persist voice model preference", { error: saveResult.error });
			toast.error(saveResult.error.message);
			return;
		}

		const selectedModel = this.models.find((model) => model.id === modelId) ?? null;
		if (!selectedModel || !selectedModel.is_downloaded) {
			console.log("[voice-settings] model not downloaded, setting ID only", { modelId });
			this.selectedModelId = modelId;
			await this.persistNormalizedLanguageForModel(selectedModel, modelId);
			return;
		}

		console.log("[voice-settings] loading model into engine", { modelId });
		const t0 = performance.now();
		const loadResult = await tauriClient.voice.loadModel(modelId);
		if (loadResult.isErr()) {
			console.error("[voice-settings] loadModel FAILED", {
				modelId,
				error: loadResult.error.message,
				elapsed_ms: Math.round(performance.now() - t0),
			});
			logger.error("Failed to load selected voice model", {
				error: loadResult.error,
				modelId,
			});
			toast.error(loadResult.error.message);
			const rollbackResult = await tauriClient.settings.set(VOICE_MODEL_KEY, previousModelId);
			if (rollbackResult.isErr()) {
				logger.error("Failed to roll back voice model preference", {
					error: rollbackResult.error,
					modelId: previousModelId,
				});
			}
			return;
		}

		console.log("[voice-settings] model loaded OK", {
			modelId,
			elapsed_ms: Math.round(performance.now() - t0),
		});
		const normalizedLanguageSaved = await this.persistNormalizedLanguageForModel(
			selectedModel,
			modelId
		);
		if (!normalizedLanguageSaved) {
			return;
		}

		this.selectedModelId = modelId;
		this.models = this.models.map((model) =>
			model.id === modelId
				? {
						id: model.id,
						name: model.name,
						size_bytes: model.size_bytes,
						is_english_only: model.is_english_only,
						is_downloaded: model.is_downloaded,
						is_loaded: true,
						download_url: model.download_url,
					}
				: {
						id: model.id,
						name: model.name,
						size_bytes: model.size_bytes,
						is_english_only: model.is_english_only,
						is_downloaded: model.is_downloaded,
						is_loaded: false,
						download_url: model.download_url,
					}
		);
	}

	async downloadModel(modelId: string): Promise<void> {
		console.log("[voice-settings] downloadModel: starting", { modelId });
		this.downloadProgressModelId = modelId;
		this.downloadPercent = 0;

		const t0 = performance.now();
		const result = await tauriClient.voice.downloadModel(modelId);
		if (result.isErr()) {
			console.error("[voice-settings] downloadModel: FAILED", {
				modelId,
				error: result.error.message,
				elapsed_ms: Math.round(performance.now() - t0),
			});
			logger.error("Failed to download voice model", {
				error: result.error,
				modelId,
			});
			if (this.downloadProgressModelId === modelId) {
				this.downloadProgressModelId = null;
				this.downloadPercent = 0;
			}
		} else {
			console.log("[voice-settings] downloadModel: complete", {
				modelId,
				elapsed_ms: Math.round(performance.now() - t0),
			});
		}
	}

	async deleteModel(modelId: string): Promise<void> {
		console.log("[voice-settings] deleteModel", { modelId });
		const result = await tauriClient.voice.deleteModel(modelId);
		if (result.isErr()) {
			console.error("[voice-settings] deleteModel: FAILED", {
				modelId,
				error: result.error.message,
			});
			logger.error("Failed to delete voice model", {
				error: result.error,
				modelId,
			});
			return;
		}

		console.log("[voice-settings] deleteModel: success, refreshing model list");
		await this.refreshModels();
	}

	private async loadPersistedSettings(): Promise<void> {
		const [enabledResult, modelResult, languageResult] = await Promise.all([
			tauriClient.settings.get<boolean>(VOICE_ENABLED_KEY),
			tauriClient.settings.get<string>(VOICE_MODEL_KEY),
			tauriClient.settings.get<string>(VOICE_LANGUAGE_KEY),
		]);

		if (enabledResult.isOk() && enabledResult.value !== null) {
			this.enabled = enabledResult.value;
		}
		if (modelResult.isOk() && modelResult.value) {
			this.selectedModelId = modelResult.value;
		}
		if (languageResult.isOk() && languageResult.value) {
			this.language = languageResult.value;
		}
	}

	private async refreshModels(): Promise<void> {
		this.modelsLoading = true;
		const result = await tauriClient.voice.listModels();
		if (result.isOk()) {
			this.models = result.value;
		} else {
			logger.error("Failed to load voice models", { error: result.error });
		}
		this.modelsLoading = false;
	}

	private async refreshLanguages(): Promise<void> {
		const result = await tauriClient.voice.listLanguages();
		if (result.isOk()) {
			this.languages = result.value;
		} else {
			logger.error("Failed to load voice languages", { error: result.error });
		}
	}

	private async preloadSelectedModel(): Promise<void> {
		const selectedModel = this.models.find((model) => model.id === this.selectedModelId) ?? null;
		if (!selectedModel || !selectedModel.is_downloaded || selectedModel.is_loaded) {
			return;
		}

		const result = await tauriClient.voice.loadModel(selectedModel.id);
		if (result.isErr()) {
			logger.warn("Failed to preload selected voice model", {
				error: result.error,
				modelId: selectedModel.id,
			});
			return;
		}

		this.models = this.models.map((model) =>
			model.id === selectedModel.id
				? {
						id: model.id,
						name: model.name,
						size_bytes: model.size_bytes,
						is_english_only: model.is_english_only,
						is_downloaded: model.is_downloaded,
						is_loaded: true,
						download_url: model.download_url,
					}
				: model
		);
	}

	private async normalizePersistedLanguage(): Promise<void> {
		const selectedModel = this.models.find((model) => model.id === this.selectedModelId) ?? null;
		const nextLanguage = normalizeLanguageForModel(selectedModel, this.language);
		if (nextLanguage === this.language) {
			return;
		}

		const result = await tauriClient.settings.set(VOICE_LANGUAGE_KEY, nextLanguage);
		if (result.isErr()) {
			logger.warn("Failed to normalize persisted voice language preference", {
				error: result.error,
				language: nextLanguage,
				modelId: this.selectedModelId,
			});
			return;
		}

		this.language = nextLanguage;
	}

	private async persistNormalizedLanguageForModel(
		model: VoiceModelInfo | null,
		modelId: string
	): Promise<boolean> {
		const nextLanguage = normalizeLanguageForModel(model, this.language);
		if (nextLanguage === this.language) {
			return true;
		}

		const result = await tauriClient.settings.set(VOICE_LANGUAGE_KEY, nextLanguage);
		if (result.isErr()) {
			logger.error("Failed to persist normalized voice language preference", {
				error: result.error,
				language: nextLanguage,
				modelId,
			});
			toast.error(result.error.message);
			return false;
		}

		this.language = nextLanguage;
		return true;
	}

	private async registerListeners(): Promise<void> {
		if (this.listenersRegistered) {
			return;
		}
		this.listenersRegistered = true;

		const [progressUnlisten, completeUnlisten, errorUnlisten] = await Promise.all([
			listen<VoiceModelDownloadProgress>("voice://model_download_progress", (event) => {
				this.downloadProgressModelId = event.payload.model_id;
				this.downloadPercent = event.payload.percent;
			}),
			listen<VoiceDownloadCompletePayload>("voice://model_download_complete", (event) => {
				console.log("[voice-settings] event: model_download_complete", {
					model_id: event.payload.model_id,
				});
				if (this.downloadProgressModelId === event.payload.model_id) {
					this.downloadProgressModelId = null;
					this.downloadPercent = 0;
				}
				void this.refreshModels();
			}),
			listen<VoiceDownloadErrorPayload>("voice://model_download_error", (event) => {
				console.error("[voice-settings] event: model_download_error", {
					model_id: event.payload.model_id,
					message: event.payload.message,
				});
				logger.error("Voice model download failed", {
					message: event.payload.message,
					modelId: event.payload.model_id,
				});
				if (this.downloadProgressModelId === event.payload.model_id) {
					this.downloadProgressModelId = null;
					this.downloadPercent = 0;
				}
			}),
		]);

		this.unlisteners.push(progressUnlisten, completeUnlisten, errorUnlisten);
	}
}

export function createVoiceSettingsStore(): VoiceSettingsStore {
	const store = new VoiceSettingsStore();
	setContext(STORE_KEY, store);
	return store;
}

export function getVoiceSettingsStore(): VoiceSettingsStore {
	return getContext<VoiceSettingsStore>(STORE_KEY);
}
