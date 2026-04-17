import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_STREAMING_ANIMATION_MODE } from "../../types/streaming-animation-mode.js";

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

	it("loads the persisted thinking preference", async () => {
		getSettingMock.mockReturnValueOnce(okAsync(true));

		const store = new ChatPreferencesStore();
		await store.initialize();

		expect(store.thinkingBlockCollapsedByDefault).toBe(true);
		expect(store.streamingAnimationMode).toBe(DEFAULT_STREAMING_ANIMATION_MODE);
	});
});
