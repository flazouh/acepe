import { describe, expect, it } from "vitest";
import { SessionTransientProjectionStore } from "../session-transient-projection-store.svelte.js";

describe("SessionTransientProjectionStore no-op updates", () => {
	it("keeps the same object when an update does not change values", () => {
		const store = new SessionTransientProjectionStore();
		store.initializeTransientProjection("session-1");

		const before = store.getTransientProjection("session-1");
		store.updateTransientProjection("session-1", {});
		const afterEmptyUpdate = store.getTransientProjection("session-1");
		store.updateTransientProjection("session-1", { pendingSendIntent: null });
		const afterSameValueUpdate = store.getTransientProjection("session-1");

		expect(afterEmptyUpdate).toBe(before);
		expect(afterSameValueUpdate).toBe(before);
	});
});
