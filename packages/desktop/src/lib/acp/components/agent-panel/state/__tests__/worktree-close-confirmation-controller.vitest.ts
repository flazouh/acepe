import { describe, expect, it } from "vitest";
import { WorktreeCloseConfirmationController } from "../worktree-close-confirmation-controller.svelte.js";

/** Vitest (not Bun): the controller uses Svelte 5 runes. */
describe("WorktreeCloseConfirmationController", () => {
	it("starts fully reset", () => {
		const c = new WorktreeCloseConfirmationController();
		expect(c.confirming).toBe(false);
		expect(c.hasDirtyChanges).toBe(false);
		expect(c.dirtyCheckPending).toBe(false);
	});

	it("beginPending opens the popover with the dirty check in flight", () => {
		const c = new WorktreeCloseConfirmationController();
		c.beginPending();
		expect(c.confirming).toBe(true);
		expect(c.dirtyCheckPending).toBe(true);
		expect(c.hasDirtyChanges).toBe(false);
	});

	it("resolve(true) settles with dirty changes and ends the pending check", () => {
		const c = new WorktreeCloseConfirmationController();
		c.beginPending();
		c.resolve(true);
		expect(c.confirming).toBe(true);
		expect(c.hasDirtyChanges).toBe(true);
		expect(c.dirtyCheckPending).toBe(false);
	});

	it("resolve(false) settles clean", () => {
		const c = new WorktreeCloseConfirmationController();
		c.beginPending();
		c.resolve(false);
		expect(c.hasDirtyChanges).toBe(false);
		expect(c.dirtyCheckPending).toBe(false);
	});

	it("dismiss clears confirming + pending but leaves hasDirtyChanges", () => {
		const c = new WorktreeCloseConfirmationController();
		c.beginPending();
		c.resolve(true);
		c.dismiss();
		expect(c.confirming).toBe(false);
		expect(c.dirtyCheckPending).toBe(false);
		expect(c.hasDirtyChanges).toBe(true);
	});

	it("cancel fully resets", () => {
		const c = new WorktreeCloseConfirmationController();
		c.beginPending();
		c.resolve(true);
		c.cancel();
		expect(c.confirming).toBe(false);
		expect(c.hasDirtyChanges).toBe(false);
		expect(c.dirtyCheckPending).toBe(false);
	});

	it("confirming is bindable (settable)", () => {
		const c = new WorktreeCloseConfirmationController();
		c.confirming = true;
		expect(c.confirming).toBe(true);
		c.confirming = false;
		expect(c.confirming).toBe(false);
	});
});
