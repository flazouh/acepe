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
		vi.mock("runed", () => ({
			Context: class TestContext {
				private value: object | null = null;

				constructor(_name: string) {}

				exists(): boolean {
					return this.value !== null;
				}

				set(value: object): object {
					this.value = value;
					return value;
				}

				get(): object | null {
					return this.value;
				}

				getOr(fallback: object): object {
					return this.value ?? fallback;
				}
			},
			ElementSize: class TestElementSize {
				readonly width = 0;
				readonly height = 0;

				constructor(_node?: object | (() => object | null), _options?: object) {}
			},
			PersistedState: class TestPersistedState<TValue> {
				current: TValue | undefined;

				constructor(_key: string, initialValue?: TValue) {
					this.current = initialValue;
				}
			},
			Previous: class TestPrevious<TValue> {
				current: TValue | undefined;

				constructor(getValue: () => TValue) {
					this.current = getValue();
				}
			},
			AnimationFrames: class TestAnimationFrames {
				readonly current = false;

				start(): void {}

				stop(): void {}
			},
			Debounced: class TestDebounced<TValue> {
				current: TValue | undefined;

				constructor(value?: TValue) {
					this.current = value;
				}
			},
			IsMounted: class TestIsMounted {
				readonly current = true;
			},
			onClickOutside: () => () => {},
			useDebounce: (callback: () => void) => callback,
			useEventListener: () => () => {},
			useResizeObserver: () => () => {},
			watch: Object.assign(
				vi.fn(() => () => {}),
				{
					pre: vi.fn(() => () => {}),
				}
			),
		}));
		vi.mock("$lib/utils/tauri-client.js", () => ({
			openFileInEditor: vi.fn(),
			revealInFinder: vi.fn(),
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
					is_loaded: false,
					download_url: "https://example.test/small.en.bin",
				},
				{
					id: "small",
					name: "Small (Multilingual)",
					size_bytes: 487601967,
					is_english_only: false,
					is_downloaded: false,
					is_loaded: false,
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

	it("loads persisted voice preferences and normalizes multilingual language to auto", async () => {
		getSettingMock
			.mockReturnValueOnce(okAsync(false))
			.mockReturnValueOnce(okAsync("small"))
			.mockReturnValueOnce(okAsync("fr"));

		const store = new VoiceSettingsStore();
		await store.initialize();

		expect(store.enabled).toBe(false);
		expect(store.selectedModelId).toBe("small");
		expect(store.language).toBe("auto");
		expect(store.models).toHaveLength(2);
		expect(store.languages).toHaveLength(3);
		expect(setSettingMock).toHaveBeenCalledWith("voice_language", "auto");
	});

	it("does not preload the selected downloaded model during initialization", async () => {
		getSettingMock
			.mockReturnValueOnce(okAsync(true))
			.mockReturnValueOnce(okAsync("small.en"))
			.mockReturnValueOnce(okAsync("auto"));

		const store = new VoiceSettingsStore();
		await store.initialize();

		expect(loadModelMock).not.toHaveBeenCalled();
	});

	it("falls back to defaults when no settings are stored", async () => {
		getSettingMock.mockReturnValue(okAsync(null));

		const store = new VoiceSettingsStore();
		await store.initialize();

		expect(store.enabled).toBe(true);
		expect(store.selectedModelId).toBe("small.en");
		expect(store.language).toBe("auto");
	});

	it("normalizes a legacy selected model to the available backend model", async () => {
		getSettingMock
			.mockReturnValueOnce(okAsync(true))
			.mockReturnValueOnce(okAsync("small.en"))
			.mockReturnValueOnce(okAsync("auto"));
		listModelsMock.mockReturnValue(
			okAsync([
				{
					id: "external",
					name: "Speech to text",
					size_bytes: 0,
					is_english_only: false,
					is_downloaded: false,
					is_loaded: false,
					download_url: "",
				},
			])
		);

		const store = new VoiceSettingsStore();
		await store.initialize();

		expect(store.selectedModelId).toBe("external");
		expect(setSettingMock).toHaveBeenCalledWith("voice_model", "external");
	});

	it("persists updates, normalizes language, and reloads a downloaded model when selected", async () => {
		getSettingMock.mockReturnValue(okAsync(null));

		const store = new VoiceSettingsStore();
		await store.initialize();

		await store.setEnabled(false);
		await store.setLanguage("es");
		await store.setSelectedModelId("small.en");

		expect(setSettingMock).toHaveBeenCalledWith("voice_enabled", false);
		expect(setSettingMock).toHaveBeenCalledWith("voice_language", "auto");
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
