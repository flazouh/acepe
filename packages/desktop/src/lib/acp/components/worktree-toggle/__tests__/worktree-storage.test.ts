import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
	clearWorktreeEnabled,
	loadWorktreeEnabled,
	saveWorktreeEnabled,
} from "../worktree-storage.js";

describe("worktree-storage", () => {
	const testPanelId = "test-panel-123";
	const storageKey = `acepe:worktree-enabled:${testPanelId}`;

	beforeEach(() => {
		localStorage.removeItem(storageKey);
	});

	afterEach(() => {
		localStorage.removeItem(storageKey);
	});

	describe("loadWorktreeEnabled", () => {
		it("returns globalDefault when no value is stored", () => {
			expect(loadWorktreeEnabled(testPanelId, false)).toBe(false);
			expect(loadWorktreeEnabled(testPanelId, true)).toBe(true);
		});

		it("returns true when stored value is 'true' regardless of globalDefault", () => {
			localStorage.setItem(storageKey, "true");
			expect(loadWorktreeEnabled(testPanelId, false)).toBe(true);
			expect(loadWorktreeEnabled(testPanelId, true)).toBe(true);
		});

		it("returns false when stored value is 'false' regardless of globalDefault", () => {
			localStorage.setItem(storageKey, "false");
			expect(loadWorktreeEnabled(testPanelId, false)).toBe(false);
			expect(loadWorktreeEnabled(testPanelId, true)).toBe(false);
		});

		it("returns globalDefault for invalid stored values", () => {
			localStorage.setItem(storageKey, "invalid");
			expect(loadWorktreeEnabled(testPanelId, false)).toBe(false);
			expect(loadWorktreeEnabled(testPanelId, true)).toBe(false);
		});

		it("handles different panel IDs independently", () => {
			const otherPanelId = "other-panel";
			localStorage.setItem(storageKey, "true");
			localStorage.setItem(`acepe:worktree-enabled:${otherPanelId}`, "false");

			expect(loadWorktreeEnabled(testPanelId, false)).toBe(true);
			expect(loadWorktreeEnabled(otherPanelId, false)).toBe(false);
		});
	});

	describe("saveWorktreeEnabled", () => {
		it("stores true value correctly", () => {
			saveWorktreeEnabled(testPanelId, true);
			expect(localStorage.getItem(storageKey)).toBe("true");
		});

		it("stores false value correctly", () => {
			saveWorktreeEnabled(testPanelId, false);
			expect(localStorage.getItem(storageKey)).toBe("false");
		});

		it("overwrites existing value", () => {
			saveWorktreeEnabled(testPanelId, true);
			expect(loadWorktreeEnabled(testPanelId, false)).toBe(true);

			saveWorktreeEnabled(testPanelId, false);
			expect(loadWorktreeEnabled(testPanelId, false)).toBe(false);
		});
	});

	describe("clearWorktreeEnabled", () => {
		it("removes stored value and falls back to globalDefault", () => {
			saveWorktreeEnabled(testPanelId, true);
			expect(loadWorktreeEnabled(testPanelId, false)).toBe(true);

			clearWorktreeEnabled(testPanelId);
			expect(loadWorktreeEnabled(testPanelId, false)).toBe(false);
			expect(loadWorktreeEnabled(testPanelId, true)).toBe(true);
			expect(localStorage.getItem(storageKey)).toBeNull();
		});
	});
});
