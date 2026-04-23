import { describe, expect, it } from "bun:test";

import {
	selectCanonicalSessionActivity,
	type CanonicalSessionActivityInput,
} from "../session-activity.js";

function makeInput(
	connectionPhase: CanonicalSessionActivityInput["lifecycle"]["connectionPhase"],
	activityPhase: CanonicalSessionActivityInput["lifecycle"]["activityPhase"],
	hasActiveOperation: boolean,
	hasPendingInput: boolean,
	hasError: boolean,
	hasUnseenCompletion: boolean
): CanonicalSessionActivityInput {
	return {
		lifecycle: {
			connectionPhase,
			activityPhase,
		},
		hasActiveOperation,
		hasPendingInput,
		hasError,
		hasUnseenCompletion,
	};
}

describe("selectCanonicalSessionActivity", () => {
	it("returns awaiting_model when the lifecycle is awaiting output with no dominant override", () => {
		expect(
			selectCanonicalSessionActivity(
				makeInput("connected", "awaiting_model", false, false, false, false)
			)
		).toBe("awaiting_model");
	});

	it("returns running_operation when an operation is still active", () => {
		expect(
			selectCanonicalSessionActivity(makeInput("connected", "running", true, false, false, false))
		).toBe("running_operation");
	});

	it("keeps active child work dominant even if the lifecycle looks like awaiting output", () => {
		expect(
			selectCanonicalSessionActivity(
				makeInput("connected", "awaiting_model", true, false, false, false)
			)
		).toBe("running_operation");
	});

	it("returns waiting_for_user when input is pending", () => {
		expect(
			selectCanonicalSessionActivity(makeInput("connected", "running", true, true, false, false))
		).toBe("waiting_for_user");
	});

	it("returns paused before running_operation", () => {
		expect(
			selectCanonicalSessionActivity(makeInput("connected", "paused", true, false, false, false))
		).toBe("paused");
	});

	it("returns error before every other state", () => {
		expect(
			selectCanonicalSessionActivity(
				makeInput("failed", "paused", true, true, true, false)
			)
		).toBe("error");
	});

	it("returns idle when only review cues remain", () => {
		expect(
			selectCanonicalSessionActivity(makeInput("connected", "idle", false, false, false, true))
		).toBe("idle");
	});
});
