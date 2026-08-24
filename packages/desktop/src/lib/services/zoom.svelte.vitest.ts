import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ZOOM_LEVEL_CACHE_KEY = "acepe.zoom_level.hot_cache";

const mocks = vi.hoisted(() => ({
	setZoom: vi.fn(() => Promise.resolve()),
	getRaw: vi.fn((): Effect.Effect<string | null, Error> => Effect.succeed(null)),
	setRaw: vi.fn((): Effect.Effect<void, Error> => Effect.succeed(undefined)),
	toastInfo: vi.fn(),
	runningUnderElectrobun: vi.fn(() => false),
}));

// getCurrentWebview() throws synchronously in a real Electrobun WebView --
// there is no window.__TAURI_INTERNALS__.metadata for it to read. This
// mock reproduces that instead of a benign stub whenever the test is
// simulating Electrobun, so a missing Electrobun guard in applyZoom shows
// up as a real test failure (see the live-QA crash this regression test
// documents: "Failed to apply zoom: TypeError: undefined is not an object
// (evaluating 'window.__TAURI_INTERNALS__.metadata')").
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => {
		if (mocks.runningUnderElectrobun() === true) {
			throw new TypeError(
				"undefined is not an object (evaluating 'window.__TAURI_INTERNALS__.metadata')"
			);
		}
		return { setZoom: mocks.setZoom };
	},
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

vi.mock("../utils/electrobun-window-shims.js", () => ({
	runningUnderElectrobun: mocks.runningUnderElectrobun,
}));

import { ZoomService } from "./zoom.svelte.js";

describe("ZoomService", () => {
	beforeEach(() => {
		mocks.setZoom.mockClear();
		mocks.getRaw.mockReset();
		mocks.setRaw.mockClear();
		mocks.toastInfo.mockClear();
		mocks.runningUnderElectrobun.mockReturnValue(false);
		mocks.getRaw.mockReturnValue(Effect.succeed<string | null>(null));
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

		const result = await Effect.runPromise(Effect.result(service.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(mocks.setZoom).not.toHaveBeenCalled();
	});

	it("does not call the WebView when saved zoom is effectively the default", async () => {
		mocks.getRaw.mockReturnValue(Effect.succeed<string | null>("0.9999999999999992"));
		const service = new ZoomService();

		const result = await Effect.runPromise(Effect.result(service.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(mocks.setZoom).not.toHaveBeenCalled();
	});

	it("uses the hot cache instead of waiting for the persisted zoom read", async () => {
		vi.useFakeTimers();
		localStorage.setItem(ZOOM_LEVEL_CACHE_KEY, "0.9999999999999992");
		mocks.getRaw.mockReturnValue(
			fromPromise(
				() => new Promise<string | null>(() => {}),
				() => new Error("Persisted read should not block initialize")
			)
		);
		const service = new ZoomService();

		const result = await Effect.runPromise(Effect.result(service.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
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
			fromPromise(
				() => new Promise<string | null>(() => {}),
				() => new Error("Persisted read should not block initialize")
			)
		);
		const service = new ZoomService();

		const result = await Effect.runPromise(Effect.result(service.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(mocks.setZoom).toHaveBeenCalledWith(1.2);
		expect(mocks.getRaw).not.toHaveBeenCalled();

		vi.advanceTimersByTime(2_000);
		vi.runOnlyPendingTimers();
		await Promise.resolve();

		expect(mocks.getRaw).toHaveBeenCalled();
	});

	it("applies a non-default saved zoom on initialize", async () => {
		mocks.getRaw.mockReturnValue(Effect.succeed<string | null>("1.2"));
		const service = new ZoomService();

		const result = await Effect.runPromise(Effect.result(service.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(mocks.setZoom).toHaveBeenCalledWith(1.2);
	});

	// Regression: caught live under Electrobun via electrobun-qa. Zoom
	// reconciliation is a delayed background step (initialize() schedules
	// reconcilePersistedZoomInBackground on a 2s idle timer), so it fires
	// well after startup and crashed the app into a global error boundary
	// mid-session -- "Failed to apply zoom: TypeError: undefined is not an
	// object (evaluating 'window.__TAURI_INTERNALS__.metadata')". There is
	// no Electrobun-side webview zoom primitive yet; applyZoom must degrade
	// the same honest way the other Tauri-only call sites in
	// electrobun-window-shims.ts do, not throw.
	it("does not call the Tauri WebView API under Electrobun, even for a non-default zoom", () => {
		mocks.runningUnderElectrobun.mockReturnValue(true);
		mocks.getRaw.mockReturnValue(Effect.succeed<string | null>("1.2"));
		const service = new ZoomService();

		return service.initialize().pipe(
			Effect.result,
			Effect.map((result) => {
				expect(Result.isSuccess(result)).toBe(true);
				expect(mocks.setZoom).not.toHaveBeenCalled();
			}),
			Effect.runPromise
		);
	});

	it("resolves setZoom under Electrobun without throwing, tracking the requested level", () => {
		mocks.runningUnderElectrobun.mockReturnValue(true);
		const service = new ZoomService();

		return service.setZoom(1.3).pipe(
			Effect.result,
			Effect.map((result) => {
				expect(Result.isSuccess(result)).toBe(true);
				expect(mocks.setZoom).not.toHaveBeenCalled();
				expect(service.zoomLevel).toBe(1.3);
			}),
			Effect.runPromise
		);
	});
});
