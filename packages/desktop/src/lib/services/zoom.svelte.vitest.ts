import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ZOOM_LEVEL_CACHE_KEY = "acepe.zoom_level.hot_cache";

const mocks = vi.hoisted(() => ({
	setShellPageZoom: vi.fn((_level: number): Effect.Effect<void> => Effect.void),
	getRaw: vi.fn((): Effect.Effect<string | null, Error> => Effect.succeed(null)),
	setRaw: vi.fn((): Effect.Effect<void, Error> => Effect.succeed(undefined)),
	toastInfo: vi.fn(),
}));

vi.mock("svelte-sonner", () => ({
	toast: {
		info: mocks.toastInfo,
	},
}));

vi.mock("$lib/utils/backend-client/settings.js", () => ({
	settings: {
		getRaw: mocks.getRaw,
		setRaw: mocks.setRaw,
	},
}));

vi.mock("$lib/rpc/shell-page-zoom.js", () => ({
	setShellPageZoom: mocks.setShellPageZoom,
}));

import { ZoomService } from "./zoom.svelte.js";

describe("ZoomService", () => {
	beforeEach(() => {
		mocks.setShellPageZoom.mockClear();
		mocks.getRaw.mockReset();
		mocks.setRaw.mockClear();
		mocks.toastInfo.mockClear();
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

	it("zooms the shell window in by one step", async () => {
		const service = new ZoomService();

		await Effect.runPromise(service.zoomIn());

		expect(mocks.setShellPageZoom).toHaveBeenCalledWith(1.1);
		expect(service.zoomLevel).toBeCloseTo(1.1);
	});

	it("zooms the shell window out by one step", async () => {
		const service = new ZoomService();

		await Effect.runPromise(service.zoomOut());

		expect(mocks.setShellPageZoom).toHaveBeenCalledWith(0.9);
		expect(service.zoomLevel).toBeCloseTo(0.9);
	});

	it("resets the shell window back to 100%", async () => {
		const service = new ZoomService();
		await Effect.runPromise(service.setZoom(1.4));
		mocks.setShellPageZoom.mockClear();

		await Effect.runPromise(service.resetZoom());

		expect(mocks.setShellPageZoom).toHaveBeenCalledWith(1);
		expect(service.zoomLevel).toBe(1);
	});

	it("clamps the requested level to the supported range", async () => {
		const service = new ZoomService();

		await Effect.runPromise(service.setZoom(9));

		expect(mocks.setShellPageZoom).toHaveBeenCalledWith(2);
	});

	it("does not call the shell when saved zoom is already the default", async () => {
		const service = new ZoomService();

		const result = await Effect.runPromise(Effect.result(service.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(mocks.setShellPageZoom).not.toHaveBeenCalled();
	});

	it("does not call the shell when saved zoom is effectively the default", async () => {
		mocks.getRaw.mockReturnValue(Effect.succeed<string | null>("0.9999999999999992"));
		const service = new ZoomService();

		const result = await Effect.runPromise(Effect.result(service.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(mocks.setShellPageZoom).not.toHaveBeenCalled();
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
		expect(mocks.setShellPageZoom).not.toHaveBeenCalled();
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
		expect(mocks.setShellPageZoom).toHaveBeenCalledWith(1.2);
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
		expect(mocks.setShellPageZoom).toHaveBeenCalledWith(1.2);
	});

	// Regression: caught live under Electrobun via electrobun-qa. Zoom
	// reconciliation is a delayed background step (initialize() schedules
	// reconcilePersistedZoomInBackground on a 2s idle timer), so it fires
	// well after startup and crashed the app into a global error boundary
	// mid-session -- "Failed to apply zoom: TypeError: undefined is not an
	// object", thrown while reading a zoom API the shell never provided. A
	// shell that cannot zoom must leave the effect successful, not throw.
	it("keeps setZoom successful when the shell cannot zoom", () => {
		mocks.setShellPageZoom.mockReturnValue(Effect.void);
		const service = new ZoomService();

		return service.setZoom(1.3).pipe(
			Effect.result,
			Effect.map((result) => {
				expect(Result.isSuccess(result)).toBe(true);
				expect(service.zoomLevel).toBe(1.3);
			}),
			Effect.runPromise
		);
	});
});
