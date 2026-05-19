import { describe, expect, it } from "vitest";

import { formatToolDurationLabel } from "./tool-duration.js";

describe("formatToolDurationLabel", () => {
	it("shows whole seconds while a tool is running", () => {
		expect(
			formatToolDurationLabel({
				startedAtMs: 1_000,
				completedAtMs: null,
				status: "running",
				nowMs: 4_400,
			})
		).toBe("3s");
	});

	it("shows precise seconds after a tool completes", () => {
		expect(
			formatToolDurationLabel({
				startedAtMs: 1_000,
				completedAtMs: 3_450,
				status: "done",
				nowMs: 10_000,
			})
		).toBe("2.45s");
	});
});
