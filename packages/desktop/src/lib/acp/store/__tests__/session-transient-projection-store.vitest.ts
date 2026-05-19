import { beforeEach, describe, expect, it } from "vitest";

import { SessionTransientProjectionStore } from "../session-transient-projection-store.svelte.js";
import { DEFAULT_TRANSIENT_PROJECTION } from "../types.js";

describe("SessionTransientProjectionStore", () => {
	let store: SessionTransientProjectionStore;

	beforeEach(() => {
		store = new SessionTransientProjectionStore();
	});

	describe("getTransientProjection", () => {
		it("returns the residual default projection for unknown sessions", () => {
			expect(store.getTransientProjection("unknown")).toEqual(DEFAULT_TRANSIENT_PROJECTION);
		});

		it("returns initialized residual state", () => {
			store.initializeTransientProjection("session1", {
				acpSessionId: "acp-1",
				autonomousTransition: "enabling",
			});

			expect(store.getTransientProjection("session1")).toMatchObject({
				acpSessionId: "acp-1",
				autonomousTransition: "enabling",
			});
		});
	});

	describe("hasTransientProjection", () => {
		it("returns false for unknown sessions", () => {
			expect(store.hasTransientProjection("unknown")).toBe(false);
		});

		it("returns true after initialization", () => {
			store.initializeTransientProjection("session1");
			expect(store.hasTransientProjection("session1")).toBe(true);
		});
	});

	describe("updateTransientProjection", () => {
		it("merges residual updates for one session", () => {
			store.initializeTransientProjection("session1");

			store.updateTransientProjection("session1", {
				acpSessionId: "acp-1",
			});
			store.updateTransientProjection("session1", {
				autonomousTransition: "enabling",
			});

			expect(store.getTransientProjection("session1")).toMatchObject({
				acpSessionId: "acp-1",
				autonomousTransition: "enabling",
			});
		});

		it("keeps residual updates isolated by session", () => {
			store.initializeTransientProjection("session1");
			store.initializeTransientProjection("session2");

			store.updateTransientProjection("session1", { acpSessionId: "acp-1" });
			store.updateTransientProjection("session2", { autonomousTransition: "disabling" });

			expect(store.getTransientProjection("session1").acpSessionId).toBe("acp-1");
			expect(store.getTransientProjection("session2").autonomousTransition).toBe("disabling");
		});

		it("accepts explicit lifecycle timestamp updates from canonical apply paths", () => {
			store.initializeTransientProjection("session1");

			store.updateTransientProjection("session1", { statusChangedAt: 123 });

			expect(store.getTransientProjection("session1").statusChangedAt).toBe(123);
		});
	});

	describe("initializeTransientProjection", () => {
		it("initializes with defaults", () => {
			store.initializeTransientProjection("session1");

			expect(store.hasTransientProjection("session1")).toBe(true);
			expect(store.getTransientProjection("session1")).toEqual(DEFAULT_TRANSIENT_PROJECTION);
		});

		it("does not reinitialize if already present", () => {
			store.initializeTransientProjection("session1", { acpSessionId: "acp-1" });
			store.initializeTransientProjection("session1", { acpSessionId: "acp-2" });

			expect(store.getTransientProjection("session1").acpSessionId).toBe("acp-1");
		});
	});

	describe("removeTransientProjection", () => {
		it("removes transient projection state", () => {
			store.initializeTransientProjection("session1");

			store.removeTransientProjection("session1");

			expect(store.hasTransientProjection("session1")).toBe(false);
			expect(store.getTransientProjection("session1")).toEqual(DEFAULT_TRANSIENT_PROJECTION);
		});

		it("handles missing sessions", () => {
			store.removeTransientProjection("missing");

			expect(store.hasTransientProjection("missing")).toBe(false);
		});
	});
});
