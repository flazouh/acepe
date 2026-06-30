import { describe, expect, it } from "bun:test";

import { shouldShowNewThreadSetupContext } from "../new-thread-setup-context.js";

describe("shouldShowNewThreadSetupContext", () => {
	it("shows setup controls before a session starts", () => {
		expect(
			shouldShowNewThreadSetupContext({
				hasSession: false,
				hasImmediatePendingSendIntent: false,
				hasMessages: false,
			})
		).toBe(true);
	});

	it("hides setup controls when a session already exists", () => {
		expect(
			shouldShowNewThreadSetupContext({
				hasSession: true,
				hasImmediatePendingSendIntent: false,
				hasMessages: false,
			})
		).toBe(false);
	});

	it("hides setup controls once a first send is pending", () => {
		expect(
			shouldShowNewThreadSetupContext({
				hasSession: false,
				hasImmediatePendingSendIntent: true,
				hasMessages: false,
			})
		).toBe(false);
	});

	it("hides setup controls once the optimistic user message is visible", () => {
		expect(
			shouldShowNewThreadSetupContext({
				hasSession: false,
				hasImmediatePendingSendIntent: false,
				hasMessages: true,
			})
		).toBe(false);
	});
});
