import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { getContext, setContext } from "svelte";
import { toast } from "svelte-sonner";
import type {
	VoiceLanguageOption,
	VoiceModelDownloadProgress,
	VoiceModelInfo,
} from "$lib/acp/types/voice-input.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const STORE_KEY = Symbol.for("acepe.voice-settings");
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
		await this.normalizeSelectedModel();
		await this.normalizePersistedLanguage();
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
		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.set(VOICE_ENABLED_KEY, value))
		);
		if (Result.isFailure(result)) {
			logger.error("Failed to persist voice enabled preference", { error: result.failure });
			toast.error(result.failure.message);
			return;
		}

		this.enabled = value;
		if (value) {
			await this.preloadSelectedModel();
		}
	}

	async setLanguage(value: string): Promise<void> {
		const nextLanguage = normalizeLanguageForModel(this.selectedModel, value);
		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.set(VOICE_LANGUAGE_KEY, nextLanguage))
		);
		if (Result.isFailure(result)) {
			logger.error("Failed to persist voice language preference", { error: result.failure });
			toast.error(result.failure.message);
			return;
		}

		this.language = nextLanguage;
	}

	async setSelectedModelId(modelId: string): Promise<void> {
		const previousModelId = this.selectedModelId;
		const saveResult = await Effect.runPromise(
			Effect.result(tauriClient.settings.set(VOICE_MODEL_KEY, modelId))
		);
		if (Result.isFailure(saveResult)) {
			logger.error("Failed to persist voice model preference", { error: saveResult.failure });
			toast.error(saveResult.failure.message);
			return;
		}

		const selectedModel = this.models.find((model) => model.id === modelId) ?? null;
		if (!selectedModel || !selectedModel.is_downloaded) {
			this.selectedModelId = modelId;
			await this.persistNormalizedLanguageForModel(selectedModel, modelId);
			return;
		}

		const loadResult = await Effect.runPromise(
			Effect.result(tauriClient.voice.loadModel(modelId))
		);
		if (Result.isFailure(loadResult)) {
			logger.error("Failed to load selected voice model", {
				error: loadResult.failure,
				modelId,
			});
			toast.error(loadResult.failure.message);
			const rollbackResult = await Effect.runPromise(
				Effect.result(tauriClient.settings.set(VOICE_MODEL_KEY, previousModelId))
			);
			if (Result.isFailure(rollbackResult)) {
				logger.error("Failed to roll back voice model preference", {
					error: rollbackResult.failure,
					modelId: previousModelId,
				});
			}
			return;
		}

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
		this.downloadProgressModelId = modelId;
		this.downloadPercent = 0;

		const result = await Effect.runPromise(
			Effect.result(tauriClient.voice.downloadModel(modelId))
		);
		if (Result.isFailure(result)) {
			logger.error("Failed to download voice model", {
				error: result.failure,
				modelId,
			});
			toast.error(result.failure.message);
			if (this.downloadProgressModelId === modelId) {
				this.downloadProgressModelId = null;
				this.downloadPercent = 0;
			}
		}
	}

	async deleteModel(modelId: string): Promise<void> {
		const result = await Effect.runPromise(
			Effect.result(tauriClient.voice.deleteModel(modelId))
		);
		if (Result.isFailure(result)) {
			logger.error("Failed to delete voice model", {
				error: result.failure,
				modelId,
			});
			return;
		}

		await this.refreshModels();
	}

	private async loadPersistedSettings(): Promise<void> {
		const [enabledResult, modelResult, languageResult] = await Promise.all([
			Effect.runPromise(Effect.result(tauriClient.settings.get<boolean>(VOICE_ENABLED_KEY))),
			Effect.runPromise(Effect.result(tauriClient.settings.get<string>(VOICE_MODEL_KEY))),
			Effect.runPromise(Effect.result(tauriClient.settings.get<string>(VOICE_LANGUAGE_KEY))),
		]);

		if (Result.isSuccess(enabledResult) && enabledResult.success !== null) {
			this.enabled = enabledResult.success;
		}
		if (Result.isSuccess(modelResult) && modelResult.success) {
			this.selectedModelId = modelResult.success;
		}
		if (Result.isSuccess(languageResult) && languageResult.success) {
			this.language = languageResult.success;
		}
	}

	private async refreshModels(): Promise<void> {
		this.modelsLoading = true;
		const result = await Effect.runPromise(Effect.result(tauriClient.voice.listModels()));
		if (Result.isSuccess(result)) {
			this.models = result.success;
		} else {
			logger.error("Failed to load voice models", { error: result.failure });
		}
		this.modelsLoading = false;
	}

	private async refreshLanguages(): Promise<void> {
		const result = await Effect.runPromise(Effect.result(tauriClient.voice.listLanguages()));
		if (Result.isSuccess(result)) {
			this.languages = result.success;
		} else {
			logger.error("Failed to load voice languages", { error: result.failure });
		}
	}

	private async normalizeSelectedModel(): Promise<void> {
		if (this.models.length === 0) {
			return;
		}

		const selectedModel = this.models.find((model) => model.id === this.selectedModelId) ?? null;
		if (selectedModel !== null) {
			return;
		}

		const nextModel = this.models[0];
		if (nextModel === undefined) {
			return;
		}

		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.set(VOICE_MODEL_KEY, nextModel.id))
		);
		if (Result.isFailure(result)) {
			logger.warn("Failed to normalize persisted voice model preference", {
				error: result.failure,
				modelId: nextModel.id,
				previousModelId: this.selectedModelId,
			});
			return;
		}

		this.selectedModelId = nextModel.id;
	}

	private async preloadSelectedModel(): Promise<void> {
		const selectedModel = this.models.find((model) => model.id === this.selectedModelId) ?? null;
		if (!selectedModel || !selectedModel.is_downloaded || selectedModel.is_loaded) {
			return;
		}

		const result = await Effect.runPromise(
			Effect.result(tauriClient.voice.loadModel(selectedModel.id))
		);
		if (Result.isFailure(result)) {
			logger.warn("Failed to preload selected voice model", {
				error: result.failure,
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

		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.set(VOICE_LANGUAGE_KEY, nextLanguage))
		);
		if (Result.isFailure(result)) {
			logger.warn("Failed to normalize persisted voice language preference", {
				error: result.failure,
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

		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.set(VOICE_LANGUAGE_KEY, nextLanguage))
		);
		if (Result.isFailure(result)) {
			logger.error("Failed to persist normalized voice language preference", {
				error: result.failure,
				language: nextLanguage,
				modelId,
			});
			toast.error(result.failure.message);
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
				if (this.downloadProgressModelId === event.payload.model_id) {
					this.downloadProgressModelId = null;
					this.downloadPercent = 0;
				}
				void this.refreshModels();
			}),
			listen<VoiceDownloadErrorPayload>("voice://model_download_error", (event) => {
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
