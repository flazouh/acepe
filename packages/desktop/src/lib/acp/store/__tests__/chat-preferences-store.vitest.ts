import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	STREAMING_ANIMATION_MODE_CLASSIC,
	STREAMING_ANIMATION_MODE_INSTANT,
	STREAMING_ANIMATION_MODE_SMOOTH,
} from "../../types/streaming-animation-mode.js";

const getSettingMock = vi.fn();
const setSettingMock = vi.fn();

let ChatPreferencesStore: typeof import("../chat-preferences-store.svelte.js").ChatPreferencesStore;

describe("ChatPreferencesStore", () => {
	beforeEach(async () => {
		getSettingMock.mockReset();
		setSettingMock.mockReset();

		vi.resetModules();
		vi.doMock("$lib/utils/tauri-client.js", () => ({
			tauriClient: {
				settings: {
					get: getSettingMock,
					set: setSettingMock,
				},
			},
		}));

		({ ChatPreferencesStore } = await import("../chat-preferences-store.svelte.js"));

		setSettingMock.mockReturnValue(okAsync(undefined));
	});

	it("defaults to smooth when no settings are stored", async () => {
		getSettingMock.mockReturnValue(okAsync(null));

		const store = new ChatPreferencesStore();
		await store.initialize();

		expect(store.thinkingBlockCollapsedByDefault).toBe(false);
		expect(store.streamingAnimationMode).toBe(DEFAULT_STREAMING_ANIMATION_MODE);
		expect(store.isReady).toBe(true);
	});

	it("loads persisted thinking and streaming animation preferences", async () => {
		getSettingMock.mockReturnValueOnce(okAsync(true)).mockReturnValueOnce(okAsync("classic"));

		const store = new ChatPreferencesStore();
		await store.initialize();

		expect(store.thinkingBlockCollapsedByDefault).toBe(true);
		expect(store.streamingAnimationMode).toBe(STREAMING_ANIMATION_MODE_CLASSIC);
	});

	it("maps legacy streaming animation values into the new three-mode model", async () => {
		getSettingMock.mockReturnValueOnce(okAsync(false)).mockReturnValueOnce(okAsync("typewriter"));

		const classicStore = new ChatPreferencesStore();
		await classicStore.initialize();
		expect(classicStore.streamingAnimationMode).toBe(STREAMING_ANIMATION_MODE_CLASSIC);

		vi.resetModules();
		vi.doMock("$lib/utils/tauri-client.js", () => ({
			tauriClient: {
				settings: {
					get: getSettingMock,
					set: setSettingMock,
				},
			},
		}));
		({ ChatPreferencesStore } = await import("../chat-preferences-store.svelte.js"));

		getSettingMock.mockReset();
		getSettingMock.mockReturnValueOnce(okAsync(false)).mockReturnValueOnce(okAsync("none"));

		const instantStore = new ChatPreferencesStore();
		await instantStore.initialize();
		expect(instantStore.streamingAnimationMode).toBe(STREAMING_ANIMATION_MODE_INSTANT);

		vi.resetModules();
		vi.doMock("$lib/utils/tauri-client.js", () => ({
			tauriClient: {
				settings: {
					get: getSettingMock,
					set: setSettingMock,
				},
			},
		}));
		({ ChatPreferencesStore } = await import("../chat-preferences-store.svelte.js"));

		getSettingMock.mockReset();
		getSettingMock.mockReturnValueOnce(okAsync(false)).mockReturnValueOnce(okAsync("glow"));

		const smoothStore = new ChatPreferencesStore();
		await smoothStore.initialize();
		expect(smoothStore.streamingAnimationMode).toBe(STREAMING_ANIMATION_MODE_SMOOTH);
	});

	it("persists streaming animation updates optimistically", async () => {
		getSettingMock.mockReturnValue(okAsync(null));

		const store = new ChatPreferencesStore();
		await store.initialize();
		await store.setStreamingAnimationMode(STREAMING_ANIMATION_MODE_INSTANT);

		expect(store.streamingAnimationMode).toBe(STREAMING_ANIMATION_MODE_INSTANT);
		expect(setSettingMock).toHaveBeenCalledWith(
			"streaming_animation",
			STREAMING_ANIMATION_MODE_INSTANT
		);
	});
});
