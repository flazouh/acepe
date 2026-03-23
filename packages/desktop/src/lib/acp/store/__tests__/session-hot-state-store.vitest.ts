import { beforeEach, describe, expect, it } from "vitest";

import { SessionHotStateStore } from "../session-hot-state-store.svelte.js";
import { DEFAULT_HOT_STATE } from "../types.js";

describe("SessionHotStateStore", () => {
	let store: SessionHotStateStore;

	beforeEach(() => {
		store = new SessionHotStateStore();
	});

	describe("getHotState", () => {
		it("should return default hot state for unknown session", () => {
			const state = store.getHotState("unknown");
			expect(state).toEqual(DEFAULT_HOT_STATE);
		});

		it("should return initialized state", () => {
			store.initializeHotState("session1", { turnState: "streaming" });

			const state = store.getHotState("session1");
			expect(state.turnState).toBe("streaming");
		});
	});

	describe("hasHotState", () => {
		it("should return false for unknown session", () => {
			expect(store.hasHotState("unknown")).toBe(false);
		});

		it("should return true after initialization", () => {
			store.initializeHotState("session1");
			expect(store.hasHotState("session1")).toBe(true);
		});
	});

	describe("updateHotState", () => {
		it("should apply multiple updates", () => {
			store.initializeHotState("session1");

			store.updateHotState("session1", { turnState: "streaming" });
			store.updateHotState("session1", { isConnected: true });
			store.updateHotState("session1", { status: "ready" });

			const state = store.getHotState("session1");
			expect(state.turnState).toBe("streaming");
			expect(state.isConnected).toBe(true);
			expect(state.status).toBe("ready");
		});

		it("should merge updates for same session (last update wins)", () => {
			store.initializeHotState("session1", { turnState: "idle", isConnected: false });

			store.updateHotState("session1", { turnState: "streaming" });
			store.updateHotState("session1", { turnState: "idle" }); // Override
			store.updateHotState("session1", { isConnected: true });

			const state = store.getHotState("session1");
			expect(state.turnState).toBe("idle"); // Last update wins
			expect(state.isConnected).toBe(true);
		});

		it("should handle updates across multiple sessions", () => {
			store.initializeHotState("session1");
			store.initializeHotState("session2");

			store.updateHotState("session1", { turnState: "streaming" });
			store.updateHotState("session2", { isConnected: true });

			expect(store.getHotState("session1").turnState).toBe("streaming");
			expect(store.getHotState("session2").isConnected).toBe(true);
		});
	});

	describe("initializeHotState", () => {
		it("should initialize with defaults", () => {
			store.initializeHotState("session1");

			expect(store.hasHotState("session1")).toBe(true);
			expect(store.getHotState("session1")).toEqual(DEFAULT_HOT_STATE);
		});

		it("should initialize with partial overrides", () => {
			store.initializeHotState("session1", { turnState: "streaming" });

			const state = store.getHotState("session1");
			expect(state.turnState).toBe("streaming");
			expect(state.isConnected).toBe(false); // Default
		});

		it("should not reinitialize if already exists", () => {
			store.initializeHotState("session1", { turnState: "streaming" });
			store.initializeHotState("session1", { turnState: "idle" }); // Should be ignored

			expect(store.getHotState("session1").turnState).toBe("streaming");
		});
	});

	describe("removeHotState", () => {
		it("should remove hot state", () => {
			store.initializeHotState("session1");
			expect(store.hasHotState("session1")).toBe(true);

			store.removeHotState("session1");

			expect(store.hasHotState("session1")).toBe(false);
		});

		it("should return default state after removal", () => {
			store.initializeHotState("session1", { turnState: "streaming" });
			store.updateHotState("session1", { isConnected: true });

			store.removeHotState("session1");

			expect(store.hasHotState("session1")).toBe(false);
			expect(store.getHotState("session1")).toEqual(DEFAULT_HOT_STATE);
		});

		it("should handle removing non-existent session gracefully", () => {
			// Should not throw
			store.removeHotState("non-existent");
			expect(store.hasHotState("non-existent")).toBe(false);
		});
	});
});
