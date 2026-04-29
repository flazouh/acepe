import { describe, expect, it } from "bun:test";

import {
	DEFAULT_TRANSIENT_PROJECTION,
	type SessionTransientProjection,
} from "../types.js";

describe("SessionTransientProjection", () => {
	it("defaults to only local residual fields", () => {
		expect(DEFAULT_TRANSIENT_PROJECTION).toMatchObject({
			acpSessionId: null,
			autonomousTransition: "idle",
			modelPerMode: {},
			pendingSendIntent: null,
			capabilityMutationState: {
				pendingMutationId: null,
				previewState: null,
			},
		});
	});

	it("does not include canonical lifecycle or capability authority fields", () => {
		expect(Object.keys(DEFAULT_TRANSIENT_PROJECTION).sort()).toEqual([
			"acpSessionId",
			"autonomousTransition",
			"capabilityMutationState",
			"modelPerMode",
			"pendingSendIntent",
			"statusChangedAt",
		]);
	});

	it("supports local send and capability mutation affordances", () => {
		const projection: SessionTransientProjection = {
			acpSessionId: "acp-1",
			autonomousTransition: "enabling",
			modelPerMode: { build: "gpt-5" },
			statusChangedAt: 123,
			pendingSendIntent: {
				attemptId: "attempt-1",
				startedAt: 456,
				promptLength: 12,
			},
			capabilityMutationState: {
				pendingMutationId: "mutation-1",
				previewState: "pending",
			},
		};

		expect(projection).toMatchObject({
			acpSessionId: "acp-1",
			autonomousTransition: "enabling",
			modelPerMode: { build: "gpt-5" },
			pendingSendIntent: {
				attemptId: "attempt-1",
			},
			capabilityMutationState: {
				pendingMutationId: "mutation-1",
				previewState: "pending",
			},
		});
	});
});
