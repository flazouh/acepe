import { describe, expect, it, vi } from "vitest";
import type { ShipCardData } from "../../../ship-card/ship-card-parser.js";
import { PrCardController, type PrFetchTarget } from "../pr-card-controller.svelte.js";

/** Vitest (not Bun): the controller uses Svelte 5 runes. */
describe("PrCardController", () => {
	// hasStreamingPreviewContent === prTitle !== null || prDescription !== null.
	const withPreview = { prTitle: "Ship it", prDescription: null } as unknown as ShipCardData;
	const noPreview = { prTitle: null, prDescription: null } as unknown as ShipCardData;

	it("starts idle", () => {
		const c = new PrCardController();
		expect(c.createRunning).toBe(false);
		expect(c.mergeRunning).toBe(false);
		expect(c.details).toBeNull();
		expect(c.streamingShipData).toBeNull();
		expect(c.renderKey).toBe(0);
	});

	it("tracks create/merge progress + label", () => {
		const c = new PrCardController();
		c.setCreateRunning(true);
		c.setCreateLabel("Opening PR…");
		c.setMergeRunning(true);
		expect(c.createRunning).toBe(true);
		expect(c.createLabel).toBe("Opening PR…");
		expect(c.mergeRunning).toBe(true);
	});

	it("bumps renderKey only on the no-preview → preview transition", () => {
		const c = new PrCardController();
		c.applyStreamUpdate(noPreview); // no preview yet
		expect(c.renderKey).toBe(0);
		c.applyStreamUpdate(withPreview); // transition → bump
		expect(c.renderKey).toBe(1);
		c.applyStreamUpdate(withPreview); // already preview → no bump
		expect(c.renderKey).toBe(1);
		expect(c.streamingShipData).toEqual(withPreview);
	});

	it("resetStream clears the streaming preview", () => {
		const c = new PrCardController();
		c.applyStreamUpdate(withPreview);
		c.resetStream();
		expect(c.streamingShipData).toBeNull();
	});

	const target = (prNumber: number): PrFetchTarget => ({
		sessionId: "s1",
		projectPath: "/repo",
		prNumber,
	});

	it("syncFetchTarget fetches once per distinct target, dedupes repeats", () => {
		const c = new PrCardController();
		const fetch = vi.fn();
		c.syncFetchTarget(target(1), fetch);
		c.syncFetchTarget(target(1), fetch); // same key → no refetch
		expect(fetch).toHaveBeenCalledTimes(1);
		c.syncFetchTarget(target(2), fetch); // new key → refetch
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("syncFetchTarget(null) clears details and resets the dedupe key", () => {
		const c = new PrCardController();
		const fetch = vi.fn();
		c.syncFetchTarget(target(1), fetch);
		c.setDetails({ number: 1 } as never);
		c.syncFetchTarget(null, fetch);
		expect(c.details).toBeNull();
		// after a clear, the same target fetches again (key was reset)
		c.syncFetchTarget(target(1), fetch);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("resetDetails clears details + error", () => {
		const c = new PrCardController();
		c.setDetails({ number: 7 } as never);
		c.resetDetails();
		expect(c.details).toBeNull();
		expect(c.fetchError).toBeNull();
	});
});
