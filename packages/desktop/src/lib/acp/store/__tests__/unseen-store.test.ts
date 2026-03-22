import { describe, expect, it } from "bun:test";

import { UnseenStore } from "../unseen-store.svelte.js";

describe("UnseenStore", () => {
	function createStore(): UnseenStore {
		return new UnseenStore();
	}

	describe("markUnseen", () => {
		it("should mark a panel as unseen", () => {
			const store = createStore();
			store.markUnseen("panel-1");
			expect(store.isUnseen("panel-1")).toBe(true);
		});

		it("should handle marking the same panel twice", () => {
			const store = createStore();
			store.markUnseen("panel-1");
			store.markUnseen("panel-1");
			expect(store.isUnseen("panel-1")).toBe(true);
			expect(store.count).toBe(1);
		});

		it("should track multiple panels independently", () => {
			const store = createStore();
			store.markUnseen("panel-1");
			store.markUnseen("panel-2");
			expect(store.isUnseen("panel-1")).toBe(true);
			expect(store.isUnseen("panel-2")).toBe(true);
			expect(store.count).toBe(2);
		});
	});

	describe("markSeen", () => {
		it("should clear unseen state for a panel", () => {
			const store = createStore();
			store.markUnseen("panel-1");
			store.markSeen("panel-1");
			expect(store.isUnseen("panel-1")).toBe(false);
		});

		it("should not affect other panels", () => {
			const store = createStore();
			store.markUnseen("panel-1");
			store.markUnseen("panel-2");
			store.markSeen("panel-1");
			expect(store.isUnseen("panel-1")).toBe(false);
			expect(store.isUnseen("panel-2")).toBe(true);
		});

		it("should be safe to call for non-unseen panel", () => {
			const store = createStore();
			store.markSeen("panel-1");
			expect(store.isUnseen("panel-1")).toBe(false);
		});
	});

	describe("isUnseen", () => {
		it("should return false for unknown panel", () => {
			const store = createStore();
			expect(store.isUnseen("panel-1")).toBe(false);
		});
	});

	describe("count", () => {
		it("should return 0 when empty", () => {
			const store = createStore();
			expect(store.count).toBe(0);
		});

		it("should track unseen count correctly", () => {
			const store = createStore();
			store.markUnseen("panel-1");
			expect(store.count).toBe(1);
			store.markUnseen("panel-2");
			expect(store.count).toBe(2);
			store.markSeen("panel-1");
			expect(store.count).toBe(1);
		});
	});

	describe("lifecycle", () => {
		it("should handle unseen -> seen -> unseen cycle", () => {
			const store = createStore();
			store.markUnseen("panel-1");
			expect(store.isUnseen("panel-1")).toBe(true);
			store.markSeen("panel-1");
			expect(store.isUnseen("panel-1")).toBe(false);
			store.markUnseen("panel-1");
			expect(store.isUnseen("panel-1")).toBe(true);
		});
	});
});
