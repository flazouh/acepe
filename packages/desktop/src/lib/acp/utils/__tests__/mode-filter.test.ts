import { describe, expect, it } from "bun:test";

import { filterVisibleModes, getUIModeDisplayName } from "../mode-filter.js";

describe("filterVisibleModes", () => {
	it("returns an empty list when canonical modes are not available yet", () => {
		expect(filterVisibleModes(null)).toEqual([]);
		expect(filterVisibleModes(undefined)).toEqual([]);
	});

	it("keeps only modes visible in the composer", () => {
		expect(
			filterVisibleModes([
				{ id: "build", name: "Build" },
				{ id: "plan", name: "Plan" },
				{ id: "other", name: "Other" },
			])
		).toEqual([
			{ id: "build", name: "Build" },
			{ id: "plan", name: "Plan" },
		]);
	});
});

describe("getUIModeDisplayName", () => {
	it("maps backend mode ids to composer labels", () => {
		expect(getUIModeDisplayName("build")).toBe("Build");
		expect(getUIModeDisplayName("plan")).toBe("Plan");
		expect(getUIModeDisplayName("custom")).toBe("custom");
	});
});
