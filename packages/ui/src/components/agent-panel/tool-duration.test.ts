import { describe, expect, it } from "vitest";

import { formatToolDurationLabel, resolveToolDurationAnimateValue } from "./tool-duration.js";

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

	it("shows whole seconds while a blocked tool is waiting", () => {
		expect(
			resolveToolDurationAnimateValue({
				startedAtMs: 1_000,
				completedAtMs: null,
				status: "blocked",
				nowMs: 5_500,
			})
		).toEqual({
			value: 4,
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		});
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

describe("resolveToolDurationAnimateValue", () => {
	it("returns whole seconds while a tool is running", () => {
		expect(
			resolveToolDurationAnimateValue({
				startedAtMs: 1_000,
				completedAtMs: null,
				status: "running",
				nowMs: 4_400,
			})
		).toEqual({
			value: 3,
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		});
	});

	it("returns precise seconds after a tool completes", () => {
		expect(
			resolveToolDurationAnimateValue({
				startedAtMs: 1_000,
				completedAtMs: 3_450,
				status: "done",
				nowMs: 10_000,
			})
		).toEqual({
			value: 2.45,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
	});
});
