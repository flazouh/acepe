import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";

const getMock = mock(() => Effect.succeed(null));
const setMock = mock(() => Effect.succeed(undefined));

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
		getMock.mockReturnValue(Effect.succeed(null));
		setMock.mockReturnValue(Effect.succeed(undefined));
	});

	it("does not expose the removed in-app toast preference", async () => {
		const store = new NotificationPreferencesStore();

		await store.initialize();

		expect("inAppToastsEnabled" in store).toBe(false);
	});
});
