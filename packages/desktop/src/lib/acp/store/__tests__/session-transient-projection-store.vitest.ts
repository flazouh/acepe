import { beforeEach, describe, expect, it } from "vitest";

import { SessionTransientProjectionStore } from "../session-transient-projection-store.svelte.js";
import { DEFAULT_TRANSIENT_PROJECTION } from "../types.js";

describe("SessionTransientProjectionStore", () => {
	let store: SessionTransientProjectionStore;

	beforeEach(() => {
		store = new SessionTransientProjectionStore();
	});

	describe("getHotState", () => {
		it("should return default transient projection for unknown session", () => {
			const state = store.getHotState("unknown");
			expect(state).toEqual(DEFAULT_TRANSIENT_PROJECTION);
			expect(state.autonomousEnabled).toBe(false);
			expect(state.autonomousTransition).toBe("idle");
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
			expect(store.getHotState("session1")).toEqual(DEFAULT_TRANSIENT_PROJECTION);
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
		it("should remove transient projection", () => {
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
			expect(store.getHotState("session1")).toEqual(DEFAULT_TRANSIENT_PROJECTION);
		});

		it("should handle removing non-existent session gracefully", () => {
			// Should not throw
			store.removeHotState("non-existent");
			expect(store.hasHotState("non-existent")).toBe(false);
		});
	});

	describe("statusChangedAt tracking", () => {
		it("should update statusChangedAt when status changes", () => {
			store.initializeHotState("session1", { status: "idle" });
			const before = store.getHotState("session1").statusChangedAt;

			store.updateHotState("session1", { status: "ready" });

			const after = store.getHotState("session1").statusChangedAt;
			expect(after).toBeGreaterThan(before ?? 0);
		});

		it("should not update statusChangedAt when status does not change", () => {
			store.initializeHotState("session1", { status: "ready" });
			store.updateHotState("session1", { status: "ready" }); // warm statusChangedAt
			const before = store.getHotState("session1").statusChangedAt;

			store.updateHotState("session1", { isConnected: true }); // unrelated update

			expect(store.getHotState("session1").statusChangedAt).toBe(before);
		});

		it("should not update statusChangedAt when same status is written again", () => {
			store.initializeHotState("session1", { status: "connecting" });
			store.updateHotState("session1", { status: "connecting" }); // no-op status change
			const ts1 = store.getHotState("session1").statusChangedAt;

			store.updateHotState("session1", { status: "connecting" });
			const ts2 = store.getHotState("session1").statusChangedAt;

			expect(ts2).toBe(ts1);
		});
	});
});
