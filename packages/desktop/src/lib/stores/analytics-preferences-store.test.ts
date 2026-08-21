import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";

const getMock = mock((): Effect.Effect<boolean | null, Error> => Effect.succeed(null));
const setMock = mock((): Effect.Effect<void, Error> => Effect.succeed(undefined));
const setAnalyticsEnabledMock = mock(async () => undefined);

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

mock.module("$lib/analytics.js", () => ({
	setAnalyticsEnabled: setAnalyticsEnabledMock,
}));

import { AnalyticsPreferencesStore } from "./analytics-preferences-store.svelte.js";

describe("analytics-preferences-store", () => {
	beforeEach(() => {
		getMock.mockReset();
		setMock.mockReset();
		setAnalyticsEnabledMock.mockReset();
		getMock.mockReturnValue(Effect.succeed(null));
		setMock.mockReturnValue(Effect.succeed(undefined));
		setAnalyticsEnabledMock.mockResolvedValue(undefined);
	});

	it("defaults to enabled when no preference is stored", async () => {
		const store = new AnalyticsPreferencesStore();

		await store.initialize();

		expect(store.enabled).toBe(true);
	});

	it("loads an opted-out preference as disabled", async () => {
		getMock.mockReturnValue(Effect.succeed(true));
		const store = new AnalyticsPreferencesStore();

		await store.initialize();

		expect(store.enabled).toBe(false);
	});

	it("persists opt-out as the inverse of enabled", async () => {
		const store = new AnalyticsPreferencesStore();

		await store.setEnabled(false);

		expect(setMock).toHaveBeenCalledWith("analytics_opt_out", true);
		expect(setAnalyticsEnabledMock).toHaveBeenCalledWith(false);
	});

	it("rolls back enabled on persist failure", async () => {
		setMock.mockReturnValue(Effect.fail(new Error("db error")));
		const store = new AnalyticsPreferencesStore();

		await store.setEnabled(false);

		expect(store.enabled).toBe(true);
		expect(setAnalyticsEnabledMock).not.toHaveBeenCalled();
	});

	it("only initializes once", async () => {
		const store = new AnalyticsPreferencesStore();

		await store.initialize();
		await store.initialize();

		expect(getMock).toHaveBeenCalledTimes(1);
	});
});
