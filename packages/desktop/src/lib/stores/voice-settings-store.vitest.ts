import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.fn();
const getSettingMock = vi.fn();
const setSettingMock = vi.fn();
const listModelsMock = vi.fn();
const listLanguagesMock = vi.fn();
const loadModelMock = vi.fn();

let VoiceSettingsStore: typeof import("./voice-settings-store.svelte.js").VoiceSettingsStore;

describe("VoiceSettingsStore", () => {
	beforeEach(async () => {
		getSettingMock.mockReset();
		setSettingMock.mockReset();
		listModelsMock.mockReset();
		listLanguagesMock.mockReset();
		loadModelMock.mockReset();
		listenMock.mockReset();

		vi.mock("@tauri-apps/api/event", () => ({
			listen: listenMock,
		}));
		vi.mock("svelte-sonner", () => ({
			toast: {
				error: vi.fn(),
				info: vi.fn(),
				success: vi.fn(),
			},
		}));
		vi.mock("runed", () => ({}));
		vi.mock("$lib/utils/tauri-client.js", () => ({
			tauriClient: {
				settings: {
					get: getSettingMock,
					set: setSettingMock,
				},
				voice: {
					listModels: listModelsMock,
					listLanguages: listLanguagesMock,
					loadModel: loadModelMock,
				},
			},
		}));

		({ VoiceSettingsStore } = await import("./voice-settings-store.svelte.js"));

		setSettingMock.mockReturnValue(okAsync(undefined));
		loadModelMock.mockReturnValue(okAsync(undefined));
		listenMock.mockResolvedValue(() => undefined);
		listModelsMock.mockReturnValue(
			okAsync([
				{
					id: "small.en",
					name: "Small (English)",
					size_bytes: 487614201,
					is_english_only: true,
					is_downloaded: true,
					download_url: "https://example.test/small.en.bin",
				},
				{
					id: "small",
					name: "Small (Multilingual)",
					size_bytes: 487601967,
					is_english_only: false,
					is_downloaded: false,
					download_url: "https://example.test/small.bin",
				},
			])
		);
		listLanguagesMock.mockReturnValue(
			okAsync([
				{ code: "en", name: "English" },
				{ code: "fr", name: "French" },
				{ code: "es", name: "Spanish" },
			])
		);
	});

	it("loads persisted voice preferences and available models", async () => {
		getSettingMock
			.mockReturnValueOnce(okAsync(false))
			.mockReturnValueOnce(okAsync("small"))
			.mockReturnValueOnce(okAsync("fr"));

		const store = new VoiceSettingsStore();
		await store.initialize();

		expect(store.enabled).toBe(false);
		expect(store.selectedModelId).toBe("small");
		expect(store.language).toBe("fr");
		expect(store.models).toHaveLength(2);
		expect(store.languages).toHaveLength(3);
	});

	it("falls back to defaults when no settings are stored", async () => {
		getSettingMock.mockReturnValue(okAsync(null));

		const store = new VoiceSettingsStore();
		await store.initialize();

		expect(store.enabled).toBe(true);
		expect(store.selectedModelId).toBe("small.en");
		expect(store.language).toBe("auto");
	});

	it("persists updates and reloads a downloaded model when selected", async () => {
		getSettingMock.mockReturnValue(okAsync(null));

		const store = new VoiceSettingsStore();
		await store.initialize();

		await store.setEnabled(false);
		await store.setLanguage("es");
		await store.setSelectedModelId("small.en");

		expect(setSettingMock).toHaveBeenCalledWith("voice_enabled", false);
		expect(setSettingMock).toHaveBeenCalledWith("voice_language", "es");
		expect(setSettingMock).toHaveBeenCalledWith("voice_model", "small.en");
		expect(loadModelMock).toHaveBeenCalledWith("small.en");
	});

	it("retries initialization after a startup failure", async () => {
		getSettingMock.mockReturnValue(okAsync(null));
		listenMock
			.mockRejectedValueOnce(new Error("listener setup failed"))
			.mockResolvedValue(() => undefined);

		const store = new VoiceSettingsStore();
		await expect(store.initialize()).rejects.toThrow("listener setup failed");
		await expect(store.initialize()).resolves.toBeUndefined();
		expect(store.models).toHaveLength(2);
	});

	it("disposes registered event listeners", async () => {
		getSettingMock.mockReturnValue(okAsync(null));
		const unlistenA = vi.fn();
		const unlistenB = vi.fn();
		const unlistenC = vi.fn();
		listenMock
			.mockResolvedValueOnce(unlistenA)
			.mockResolvedValueOnce(unlistenB)
			.mockResolvedValueOnce(unlistenC);

		const store = new VoiceSettingsStore();
		await store.initialize();
		store.dispose();

		expect(unlistenA).toHaveBeenCalledTimes(1);
		expect(unlistenB).toHaveBeenCalledTimes(1);
		expect(unlistenC).toHaveBeenCalledTimes(1);
	});

	it("rolls back the selected model when loading the new model fails", async () => {
		getSettingMock
			.mockReturnValueOnce(okAsync(true))
			.mockReturnValueOnce(okAsync("small"))
			.mockReturnValueOnce(okAsync("auto"));
		loadModelMock.mockReturnValue(errAsync(new Error("load failed")));

		const store = new VoiceSettingsStore();
		await store.initialize();
		await store.setSelectedModelId("small.en");

		expect(store.selectedModelId).toBe("small");
		expect(setSettingMock).toHaveBeenCalledWith("voice_model", "small.en");
		expect(setSettingMock).toHaveBeenCalledWith("voice_model", "small");
	});
});
