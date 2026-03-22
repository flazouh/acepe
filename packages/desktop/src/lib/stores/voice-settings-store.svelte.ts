import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getContext, setContext } from "svelte";
import { get, type Readable, type Subscriber, type Unsubscriber, writable } from "svelte/store";
import { toast } from "svelte-sonner";

import { createLogger } from "$lib/acp/utils/logger.js";
import type {
	VoiceLanguageOption,
	VoiceModelDownloadProgress,
	VoiceModelInfo,
} from "$lib/acp/types/voice-input.js";
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

interface VoiceDownloadCompletePayload {
	model_id: string;
}

interface VoiceDownloadErrorPayload {
	model_id: string;
	message: string;
}

interface VoiceSettingsState {
	readonly enabled: boolean;
	readonly selectedModelId: string;
	readonly language: string;
	readonly models: VoiceModelInfo[];
	readonly languages: VoiceLanguageOption[];
	readonly modelsLoading: boolean;
	readonly downloadProgressModelId: string | null;
	readonly downloadPercent: number;
}

const INITIAL_STATE: VoiceSettingsState = {
	enabled: true,
	selectedModelId: DEFAULT_MODEL_ID,
	language: DEFAULT_LANGUAGE,
	models: [],
	languages: [],
	modelsLoading: true,
	downloadProgressModelId: null,
	downloadPercent: 0,
};

export class VoiceSettingsStore implements Readable<VoiceSettingsState> {
	private readonly state = writable<VoiceSettingsState>(INITIAL_STATE);

	private initialized = false;
	private listenersRegistered = false;
	private readonly unlisteners: UnlistenFn[] = [];

	subscribe(run: Subscriber<VoiceSettingsState>): Unsubscriber {
		return this.state.subscribe(run);
	}

	get enabled(): boolean {
		return get(this.state).enabled;
	}

	get selectedModelId(): string {
		return get(this.state).selectedModelId;
	}

	get language(): string {
		return get(this.state).language;
	}

	get models(): VoiceModelInfo[] {
		return get(this.state).models;
	}

	get languages(): VoiceLanguageOption[] {
		return get(this.state).languages;
	}

	get modelsLoading(): boolean {
		return get(this.state).modelsLoading;
	}

	get downloadProgressModelId(): string | null {
		return get(this.state).downloadProgressModelId;
	}

	get downloadPercent(): number {
		return get(this.state).downloadPercent;
	}

	get selectedModel(): VoiceModelInfo | null {
		return get(this.state).models.find((model) => model.id === this.selectedModelId) ?? null;
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		try {
			await Promise.all([
				this.loadPersistedSettings(),
				this.refreshModels(),
				this.refreshLanguages(),
				this.registerListeners(),
			]);
			this.initialized = true;
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	dispose(): void {
		for (const unlisten of this.unlisteners.splice(0)) {
			unlisten();
		}
		this.initialized = false;
		this.listenersRegistered = false;
	}

	async setEnabled(value: boolean): Promise<void> {
		const result = await tauriClient.settings.set(VOICE_ENABLED_KEY, value);
		if (result.isErr()) {
			logger.error("Failed to persist voice enabled preference", { error: result.error });
			toast.error(result.error.message);
			return;
		}

		const current = get(this.state);
		this.state.set({
			enabled: value,
			selectedModelId: current.selectedModelId,
			language: current.language,
			models: current.models,
			languages: current.languages,
			modelsLoading: current.modelsLoading,
			downloadProgressModelId: current.downloadProgressModelId,
			downloadPercent: current.downloadPercent,
		});
	}

	async setLanguage(value: string): Promise<void> {
		const result = await tauriClient.settings.set(VOICE_LANGUAGE_KEY, value);
		if (result.isErr()) {
			logger.error("Failed to persist voice language preference", { error: result.error });
			toast.error(result.error.message);
			return;
		}

		const current = get(this.state);
		this.state.set({
			enabled: current.enabled,
			selectedModelId: current.selectedModelId,
			language: value,
			models: current.models,
			languages: current.languages,
			modelsLoading: current.modelsLoading,
			downloadProgressModelId: current.downloadProgressModelId,
			downloadPercent: current.downloadPercent,
		});
	}

	async setSelectedModelId(modelId: string): Promise<void> {
		const current = get(this.state);
		const saveResult = await tauriClient.settings.set(VOICE_MODEL_KEY, modelId);
		if (saveResult.isErr()) {
			logger.error("Failed to persist voice model preference", { error: saveResult.error });
			toast.error(saveResult.error.message);
			return;
		}

		const selectedModel = this.models.find((model) => model.id === modelId) ?? null;
		if (!selectedModel || !selectedModel.is_downloaded) {
			this.state.set({
				enabled: current.enabled,
				selectedModelId: modelId,
				language: current.language,
				models: current.models,
				languages: current.languages,
				modelsLoading: current.modelsLoading,
				downloadProgressModelId: current.downloadProgressModelId,
				downloadPercent: current.downloadPercent,
			});
			return;
		}

		const loadResult = await tauriClient.voice.loadModel(modelId);
		if (loadResult.isErr()) {
			logger.error("Failed to load selected voice model", {
				error: loadResult.error,
				modelId,
			});
			toast.error(loadResult.error.message);
			const rollbackResult = await tauriClient.settings.set(
				VOICE_MODEL_KEY,
				current.selectedModelId,
			);
			if (rollbackResult.isErr()) {
				logger.error("Failed to roll back voice model preference", {
					error: rollbackResult.error,
					modelId: current.selectedModelId,
				});
			}
			return;
		}

		this.state.set({
			enabled: current.enabled,
			selectedModelId: modelId,
			language: current.language,
			models: current.models,
			languages: current.languages,
			modelsLoading: current.modelsLoading,
			downloadProgressModelId: current.downloadProgressModelId,
			downloadPercent: current.downloadPercent,
		});
	}

	async downloadModel(modelId: string): Promise<void> {
		const current = get(this.state);
		this.state.set({
			enabled: current.enabled,
			selectedModelId: current.selectedModelId,
			language: current.language,
			models: current.models,
			languages: current.languages,
			modelsLoading: current.modelsLoading,
			downloadProgressModelId: modelId,
			downloadPercent: 0,
		});

		const result = await tauriClient.voice.downloadModel(modelId);
		if (result.isErr()) {
			logger.error("Failed to download voice model", {
				error: result.error,
				modelId,
			});
			if (this.downloadProgressModelId === modelId) {
				const failedState = get(this.state);
				this.state.set({
					enabled: failedState.enabled,
					selectedModelId: failedState.selectedModelId,
					language: failedState.language,
					models: failedState.models,
					languages: failedState.languages,
					modelsLoading: failedState.modelsLoading,
					downloadProgressModelId: null,
					downloadPercent: 0,
				});
			}
		}
	}

	async deleteModel(modelId: string): Promise<void> {
		const result = await tauriClient.voice.deleteModel(modelId);
		if (result.isErr()) {
			logger.error("Failed to delete voice model", {
				error: result.error,
				modelId,
			});
			return;
		}

		await this.refreshModels();
	}

	private async loadPersistedSettings(): Promise<void> {
		const [enabledResult, modelResult, languageResult] = await Promise.all([
			tauriClient.settings.get<boolean>(VOICE_ENABLED_KEY),
			tauriClient.settings.get<string>(VOICE_MODEL_KEY),
			tauriClient.settings.get<string>(VOICE_LANGUAGE_KEY),
		]);

		const current = get(this.state);
		this.state.set({
			enabled: enabledResult.isOk() && enabledResult.value !== null ? enabledResult.value : current.enabled,
			selectedModelId: modelResult.isOk() && modelResult.value ? modelResult.value : current.selectedModelId,
			language: languageResult.isOk() && languageResult.value ? languageResult.value : current.language,
			models: current.models,
			languages: current.languages,
			modelsLoading: current.modelsLoading,
			downloadProgressModelId: current.downloadProgressModelId,
			downloadPercent: current.downloadPercent,
		});
	}

	private async refreshModels(): Promise<void> {
		const loadingState = get(this.state);
		this.state.set({
			enabled: loadingState.enabled,
			selectedModelId: loadingState.selectedModelId,
			language: loadingState.language,
			models: loadingState.models,
			languages: loadingState.languages,
			modelsLoading: true,
			downloadProgressModelId: loadingState.downloadProgressModelId,
			downloadPercent: loadingState.downloadPercent,
		});
		const result = await tauriClient.voice.listModels();
		const current = get(this.state);
		if (result.isOk()) {
			this.state.set({
				enabled: current.enabled,
				selectedModelId: current.selectedModelId,
				language: current.language,
				models: result.value,
				languages: current.languages,
				modelsLoading: false,
				downloadProgressModelId: current.downloadProgressModelId,
				downloadPercent: current.downloadPercent,
			});
		} else {
			logger.error("Failed to load voice models", { error: result.error });
			this.state.set({
				enabled: current.enabled,
				selectedModelId: current.selectedModelId,
				language: current.language,
				models: current.models,
				languages: current.languages,
				modelsLoading: false,
				downloadProgressModelId: current.downloadProgressModelId,
				downloadPercent: current.downloadPercent,
			});
		}
	}

	private async refreshLanguages(): Promise<void> {
		const result = await tauriClient.voice.listLanguages();
		if (result.isOk()) {
			const current = get(this.state);
			this.state.set({
				enabled: current.enabled,
				selectedModelId: current.selectedModelId,
				language: current.language,
				models: current.models,
				languages: result.value,
				modelsLoading: current.modelsLoading,
				downloadProgressModelId: current.downloadProgressModelId,
				downloadPercent: current.downloadPercent,
			});
		} else {
			logger.error("Failed to load voice languages", { error: result.error });
		}
	}

	private async registerListeners(): Promise<void> {
		if (this.listenersRegistered) {
			return;
		}
		this.listenersRegistered = true;

		const [progressUnlisten, completeUnlisten, errorUnlisten] = await Promise.all([
			listen<VoiceModelDownloadProgress>("voice://model_download_progress", (event) => {
				const current = get(this.state);
				this.state.set({
					enabled: current.enabled,
					selectedModelId: current.selectedModelId,
					language: current.language,
					models: current.models,
					languages: current.languages,
					modelsLoading: current.modelsLoading,
					downloadProgressModelId: event.payload.model_id,
					downloadPercent: event.payload.percent,
				});
			}),
			listen<VoiceDownloadCompletePayload>("voice://model_download_complete", (event) => {
				const current = get(this.state);
				if (this.downloadProgressModelId === event.payload.model_id) {
					this.state.set({
						enabled: current.enabled,
						selectedModelId: current.selectedModelId,
						language: current.language,
						models: current.models,
						languages: current.languages,
						modelsLoading: current.modelsLoading,
						downloadProgressModelId: null,
						downloadPercent: 0,
					});
				}
				void this.refreshModels();
			}),
			listen<VoiceDownloadErrorPayload>("voice://model_download_error", (event) => {
				logger.error("Voice model download failed", {
					message: event.payload.message,
					modelId: event.payload.model_id,
				});
				if (this.downloadProgressModelId === event.payload.model_id) {
					const current = get(this.state);
					this.state.set({
						enabled: current.enabled,
						selectedModelId: current.selectedModelId,
						language: current.language,
						models: current.models,
						languages: current.languages,
						modelsLoading: current.modelsLoading,
						downloadProgressModelId: null,
						downloadPercent: 0,
					});
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