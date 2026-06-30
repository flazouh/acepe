import { describe, expect, it } from "vitest";

import { shouldDisconnectSessionsOnMainAppDestroy } from "../logic/main-app-destroy-policy.js";

describe("main app destroy policy", () => {
	it("disconnects sessions for real app teardown", () => {
		expect(
			shouldDisconnectSessionsOnMainAppDestroy({
				hmrTeardownActive: false,
			})
		).toBe(true);
	});

	it("keeps sessions alive during Vite HMR teardown", () => {
		expect(
			shouldDisconnectSessionsOnMainAppDestroy({
				hmrTeardownActive: true,
			})
		).toBe(false);
	});
});
