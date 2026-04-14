import { beforeEach, describe, expect, it, mock } from "bun:test";

interface MockGetResult {
	isOk: () => boolean;
	value: boolean | null;
}

const getMock = mock(async (): Promise<MockGetResult> => ({ isOk: () => true, value: null }));
const setMock = mock(async () => ({ isOk: () => true, isErr: () => false }));
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
		getMock.mockResolvedValue({ isOk: () => true, value: null });
		setMock.mockResolvedValue({ isOk: () => true, isErr: () => false });
		setAnalyticsEnabledMock.mockResolvedValue(undefined);
	});

	it("defaults to enabled when no preference is stored", async () => {
		const store = new AnalyticsPreferencesStore();

		await store.initialize();

		expect(store.enabled).toBe(true);
	});

	it("loads an opted-out preference as disabled", async () => {
		getMock.mockResolvedValue({ isOk: () => true, value: true });
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
		setMock.mockResolvedValue({ isOk: () => false, isErr: () => true, error: "db error" } as never);
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
