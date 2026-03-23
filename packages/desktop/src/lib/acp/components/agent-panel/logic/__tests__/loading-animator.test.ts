import { describe, expect, it } from "bun:test";

import { calculateLoadingProgress, isLoadingComplete } from "../loading-animator";

describe("calculateLoadingProgress", () => {
	it("should return 0% at start", () => {
		expect(calculateLoadingProgress(1000, 1000, 2000)).toBe(0);
	});

	it("should return 50% at halfway point", () => {
		expect(calculateLoadingProgress(1000, 2000, 2000)).toBe(50);
	});

	it("should return 100% at completion", () => {
		expect(calculateLoadingProgress(1000, 3000, 2000)).toBe(100);
	});

	it("should cap at 100% beyond duration", () => {
		expect(calculateLoadingProgress(1000, 5000, 2000)).toBe(100);
	});

	it("should round progress to nearest integer", () => {
		expect(calculateLoadingProgress(1000, 1666, 2000)).toBe(33);
	});

	it("should handle custom duration", () => {
		expect(calculateLoadingProgress(1000, 1500, 1000)).toBe(50);
	});
});

describe("isLoadingComplete", () => {
	it("should return false for incomplete", () => {
		expect(isLoadingComplete(0)).toBe(false);
		expect(isLoadingComplete(50)).toBe(false);
		expect(isLoadingComplete(99)).toBe(false);
	});

	it("should return true for complete", () => {
		expect(isLoadingComplete(100)).toBe(true);
	});

	it("should return true for over 100%", () => {
		expect(isLoadingComplete(150)).toBe(true);
	});
});
