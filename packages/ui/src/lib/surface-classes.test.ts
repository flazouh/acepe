import { describe, expect, it } from "bun:test";

import {
	clampSurfaceLevel,
	dropdownSurfaceClasses,
	surfaceClasses,
} from "./surface-classes.js";

describe("surfaceClasses", () => {
	it("returns literal bg and shadow utilities for valid levels", () => {
		expect(surfaceClasses(3, 3)).toBe("bg-surface-3 shadow-surface-3");
	});

	it("clamps out-of-range levels", () => {
		expect(clampSurfaceLevel(0)).toBe(1);
		expect(clampSurfaceLevel(99)).toBe(8);
		expect(surfaceClasses(0, 99)).toBe("bg-surface-1 shadow-surface-8");
	});

	it("uses fixed shadow-3 for dropdown surfaces", () => {
		expect(dropdownSurfaceClasses(1)).toBe("bg-surface-3 shadow-surface-3");
		expect(dropdownSurfaceClasses(3)).toBe("bg-surface-5 shadow-surface-3");
	});
});
