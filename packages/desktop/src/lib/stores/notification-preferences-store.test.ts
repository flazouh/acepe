import { beforeEach, describe, expect, it, mock } from "bun:test";

const getMock = mock(async () => ({ isOk: () => true, value: null }));
const setMock = mock(() => ({ mapErr: () => ({}) }));

mock.module("svelte", () => ({
	getContext: mock(() => {
		throw new Error("getContext not implemented in test");
	}),
	setContext: mock(() => {}),
}));

mock.module("$lib/acp/utils/logger.js", () => ({
	createLogger: () => ({
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	}),
}));

mock.module("$lib/utils/tauri-client.js", () => ({
	openFileInEditor: mock(() => undefined),
	revealInFinder: mock(() => undefined),
	tauriClient: {
		settings: {
			get: getMock,
			set: setMock,
		},
	},
}));

import { NotificationPreferencesStore } from "./notification-preferences-store.svelte.js";

describe("notification-preferences-store", () => {
	beforeEach(() => {
		getMock.mockReset();
		setMock.mockClear();
		getMock.mockResolvedValue({ isOk: () => true, value: null });
	});

	it("does not expose the removed in-app toast preference", async () => {
		const store = new NotificationPreferencesStore();

		await store.initialize();

		expect("inAppToastsEnabled" in store).toBe(false);
	});
});
