import { describe, expect, it } from "vitest";

import { formatErrorWithCauses, getErrorCauseDetails } from "../error-cause-details.js";

describe("error-cause-details", () => {
	it("formats nested error causes in order", () => {
		const dbError = new Error("FOREIGN KEY constraint failed");
		const tauriError = new Error("Failed to create checkpoint");
		(tauriError as Error & { cause?: Error }).cause = dbError;
		const appError = new Error("Agent operation failed: checkpoint_create");
		(appError as Error & { cause?: Error }).cause = tauriError;

		const details = getErrorCauseDetails(appError);

		expect(details.chain).toEqual([
			"Agent operation failed: checkpoint_create",
			"Failed to create checkpoint",
			"FOREIGN KEY constraint failed",
		]);
		expect(details.rootCause).toBe("FOREIGN KEY constraint failed");
		expect(details.formatted).toBe(
			"Agent operation failed: checkpoint_create (cause: Failed to create checkpoint -> FOREIGN KEY constraint failed)"
		);
		expect(formatErrorWithCauses(appError)).toBe(details.formatted);
	});

	it("handles cyclical cause chains without infinite loop", () => {
		const errA = new Error("A");
		const errB = new Error("B");
		(errA as Error & { cause?: Error }).cause = errB;
		(errB as Error & { cause?: Error }).cause = errA;

		const details = getErrorCauseDetails(errA);

		expect(details.chain).toEqual(["A", "B"]);
		expect(details.rootCause).toBe("B");
	});
});
