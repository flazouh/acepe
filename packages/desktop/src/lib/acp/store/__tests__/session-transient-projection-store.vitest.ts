import { beforeEach, describe, expect, it } from "vitest";

import { SessionTransientProjectionStore } from "../session-transient-projection-store.svelte.js";
import { DEFAULT_TRANSIENT_PROJECTION } from "../types.js";

describe("SessionTransientProjectionStore", () => {
	let store: SessionTransientProjectionStore;

	beforeEach(() => {
		store = new SessionTransientProjectionStore();
	});

	describe("getHotState", () => {
		it("returns the residual default projection for unknown sessions", () => {
			expect(store.getHotState("unknown")).toEqual(DEFAULT_TRANSIENT_PROJECTION);
		});

		it("returns initialized residual state", () => {
			store.initializeHotState("session1", {
				acpSessionId: "acp-1",
				autonomousTransition: "enabling",
			});

			expect(store.getHotState("session1")).toMatchObject({
				acpSessionId: "acp-1",
				autonomousTransition: "enabling",
			});
		});
	});

	describe("hasHotState", () => {
		it("returns false for unknown sessions", () => {
			expect(store.hasHotState("unknown")).toBe(false);
		});

		it("returns true after initialization", () => {
			store.initializeHotState("session1");
			expect(store.hasHotState("session1")).toBe(true);
		});
	});

	describe("updateHotState", () => {
		it("merges residual updates for one session", () => {
			store.initializeHotState("session1");

			store.updateHotState("session1", {
				acpSessionId: "acp-1",
				modelPerMode: { build: "gpt-5" },
			});
			store.updateHotState("session1", {
				localPersistedSessionProbeStatus: "permanent-reattach-failure",
			});

			expect(store.getHotState("session1")).toMatchObject({
				acpSessionId: "acp-1",
				modelPerMode: { build: "gpt-5" },
				localPersistedSessionProbeStatus: "permanent-reattach-failure",
			});
		});

		it("keeps residual updates isolated by session", () => {
			store.initializeHotState("session1");
			store.initializeHotState("session2");

			store.updateHotState("session1", { acpSessionId: "acp-1" });
			store.updateHotState("session2", { autonomousTransition: "disabling" });

			expect(store.getHotState("session1").acpSessionId).toBe("acp-1");
			expect(store.getHotState("session2").autonomousTransition).toBe("disabling");
		});

		it("accepts explicit lifecycle timestamp updates from canonical apply paths", () => {
			store.initializeHotState("session1");

			store.updateHotState("session1", { statusChangedAt: 123 });

			expect(store.getHotState("session1").statusChangedAt).toBe(123);
		});
	});

	describe("initializeHotState", () => {
		it("initializes with defaults", () => {
			store.initializeHotState("session1");

			expect(store.hasHotState("session1")).toBe(true);
			expect(store.getHotState("session1")).toEqual(DEFAULT_TRANSIENT_PROJECTION);
		});

		it("does not reinitialize if already present", () => {
			store.initializeHotState("session1", { acpSessionId: "acp-1" });
			store.initializeHotState("session1", { acpSessionId: "acp-2" });

			expect(store.getHotState("session1").acpSessionId).toBe("acp-1");
		});
	});

	describe("removeHotState", () => {
		it("removes transient projection state", () => {
			store.initializeHotState("session1");

			store.removeHotState("session1");

			expect(store.hasHotState("session1")).toBe(false);
			expect(store.getHotState("session1")).toEqual(DEFAULT_TRANSIENT_PROJECTION);
		});

		it("handles missing sessions", () => {
			store.removeHotState("missing");

			expect(store.hasHotState("missing")).toBe(false);
		});
	});
});
