import { okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ZOOM_LEVEL_CACHE_KEY = "acepe.zoom_level.hot_cache";

const mocks = vi.hoisted(() => ({
	setZoom: vi.fn(() => Promise.resolve()),
	getRaw: vi.fn(() => okAsync<string | null, Error>(null)),
	setRaw: vi.fn(() => okAsync<void, Error>(undefined)),
	toastInfo: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({
		setZoom: mocks.setZoom,
	}),
}));

vi.mock("svelte-sonner", () => ({
	toast: {
		info: mocks.toastInfo,
	},
}));

vi.mock("$lib/utils/tauri-client/settings.js", () => ({
	settings: {
		getRaw: mocks.getRaw,
		setRaw: mocks.setRaw,
	},
}));

import { ZoomService } from "./zoom.svelte.js";

describe("ZoomService", () => {
	beforeEach(() => {
		mocks.setZoom.mockClear();
		mocks.getRaw.mockReset();
		mocks.setRaw.mockClear();
		mocks.toastInfo.mockClear();
		mocks.getRaw.mockReturnValue(okAsync<string | null, Error>(null));
		localStorage.clear();
	});

	afterEach(() => {
		if (vi.isFakeTimers()) {
			vi.runOnlyPendingTimers();
			vi.clearAllTimers();
			vi.useRealTimers();
		}
	});

	it("does not call the WebView when saved zoom is already the default", async () => {
		const service = new ZoomService();

		const result = await service.initialize();

		expect(result.isOk()).toBe(true);
		expect(mocks.setZoom).not.toHaveBeenCalled();
	});

	it("does not call the WebView when saved zoom is effectively the default", async () => {
		mocks.getRaw.mockReturnValue(okAsync<string | null, Error>("0.9999999999999992"));
		const service = new ZoomService();

		const result = await service.initialize();

		expect(result.isOk()).toBe(true);
		expect(mocks.setZoom).not.toHaveBeenCalled();
	});

	it("uses the hot cache instead of waiting for the persisted zoom read", async () => {
		vi.useFakeTimers();
		localStorage.setItem(ZOOM_LEVEL_CACHE_KEY, "0.9999999999999992");
		mocks.getRaw.mockReturnValue(
			ResultAsync.fromPromise(
				new Promise<string | null>(() => {}),
				() => new Error("Persisted read should not block initialize")
			)
		);
		const service = new ZoomService();

		const result = await service.initialize();

		expect(result.isOk()).toBe(true);
		expect(mocks.setZoom).not.toHaveBeenCalled();
		expect(mocks.getRaw).not.toHaveBeenCalled();

		vi.advanceTimersByTime(2_000);
		vi.runOnlyPendingTimers();
		await Promise.resolve();

		expect(mocks.getRaw).toHaveBeenCalled();
	});

	it("applies a non-default cached zoom while the persisted read happens later", async () => {
		vi.useFakeTimers();
		localStorage.setItem(ZOOM_LEVEL_CACHE_KEY, "1.2");
		mocks.getRaw.mockReturnValue(
			ResultAsync.fromPromise(
				new Promise<string | null>(() => {}),
				() => new Error("Persisted read should not block initialize")
			)
		);
		const service = new ZoomService();

		const result = await service.initialize();

		expect(result.isOk()).toBe(true);
		expect(mocks.setZoom).toHaveBeenCalledWith(1.2);
		expect(mocks.getRaw).not.toHaveBeenCalled();

		vi.advanceTimersByTime(2_000);
		vi.runOnlyPendingTimers();
		await Promise.resolve();

		expect(mocks.getRaw).toHaveBeenCalled();
	});

	it("applies a non-default saved zoom on initialize", async () => {
		mocks.getRaw.mockReturnValue(okAsync<string | null, Error>("1.2"));
		const service = new ZoomService();

		const result = await service.initialize();

		expect(result.isOk()).toBe(true);
		expect(mocks.setZoom).toHaveBeenCalledWith(1.2);
	});
});
