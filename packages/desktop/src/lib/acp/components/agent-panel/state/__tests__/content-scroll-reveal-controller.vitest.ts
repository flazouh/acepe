import { describe, expect, it } from "vitest";
import { ContentScrollRevealController } from "../content-scroll-reveal-controller.svelte.js";

/** Vitest (not Bun): the controller uses Svelte 5 runes. */
describe("ContentScrollRevealController", () => {
	it("defaults: at top + bottom, not streaming, zero revisions", () => {
		const c = new ContentScrollRevealController();
		expect(c.isAtBottom).toBe(true);
		expect(c.isAtTop).toBe(true);
		expect(c.isStreaming).toBe(false);
		expect(c.settleRevision).toBe(0);
		expect(c.userRevealRequestVersion).toBe(0);
	});

	it("scroll-position flags are writable (bindable)", () => {
		const c = new ContentScrollRevealController();
		c.isAtBottom = false;
		c.isAtTop = false;
		c.isStreaming = true;
		expect(c.isAtBottom).toBe(false);
		expect(c.isAtTop).toBe(false);
		expect(c.isStreaming).toBe(true);
	});

	it("setSettleRevision updates the revision", () => {
		const c = new ContentScrollRevealController();
		c.setSettleRevision(c.settleRevision + 1);
		expect(c.settleRevision).toBe(1);
	});

	it("requestUserReveal increments and returns the new version", () => {
		const c = new ContentScrollRevealController();
		expect(c.requestUserReveal()).toBe(1);
		expect(c.requestUserReveal()).toBe(2);
		expect(c.userRevealRequestVersion).toBe(2);
	});
});
