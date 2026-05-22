import { describe, expect, it } from "bun:test";

import { filterVisibleModes, getUIModeDisplayName } from "../mode-filter.js";

describe("filterVisibleModes", () => {
	it("returns an empty list when canonical modes are not available yet", () => {
		expect(filterVisibleModes(null)).toEqual([]);
		expect(filterVisibleModes(undefined)).toEqual([]);
	});

	it("keeps every provider mode visible in the composer", () => {
		expect(
			filterVisibleModes([
				{ id: "build", name: "Build" },
				{ id: "plan", name: "Plan" },
				{ id: "other", name: "Other" },
			])
		).toEqual([
			{ id: "build", name: "Build" },
			{ id: "plan", name: "Plan" },
			{ id: "other", name: "Other" },
		]);
	});
});

describe("getUIModeDisplayName", () => {
	it("creates readable fallback labels from provider mode ids", () => {
		expect(getUIModeDisplayName("build")).toBe("Build");
		expect(getUIModeDisplayName("plan")).toBe("Plan");
		expect(getUIModeDisplayName("custom-mode")).toBe("Custom Mode");
	});
});
