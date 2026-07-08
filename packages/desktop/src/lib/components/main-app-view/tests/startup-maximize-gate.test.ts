import { describe, expect, it } from "bun:test";

import {
	canMaximizeFromStartupGate,
	createCheckingUpdaterState,
	createErrorUpdaterState,
	createIdleUpdaterState,
} from "../logic/updater-state.js";

describe("startup maximize gate", () => {
	it("opens when onboarding has resolved to hidden", () => {
		expect(canMaximizeFromStartupGate(false)).toBe(true);
	});

	it("stays blocked while onboarding state is still unresolved", () => {
		expect(canMaximizeFromStartupGate(null)).toBe(false);
	});

	it("does not let updater states block startup maximize anymore", () => {
		expect(createIdleUpdaterState().kind).toBe("idle");
		expect(createCheckingUpdaterState().kind).toBe("checking");
		expect(createErrorUpdaterState("failed").kind).toBe("error");
		expect(canMaximizeFromStartupGate(false)).toBe(true);
	});
});
