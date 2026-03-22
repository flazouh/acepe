import { describe, expect, it } from "bun:test";

import {
	isEscapeKey,
	isNavigationKey,
	isSelectionKey,
	navigateDown,
	navigateUp,
} from "../keyboard-navigation.js";

describe("navigateDown", () => {
	it("should increment index by 1", () => {
		expect(navigateDown(0, 5)).toBe(1);
		expect(navigateDown(1, 5)).toBe(2);
		expect(navigateDown(2, 5)).toBe(3);
	});

	it("should wrap to 0 when at end", () => {
		expect(navigateDown(4, 5)).toBe(0);
	});

	it("should return 0 when totalItems is 0", () => {
		expect(navigateDown(0, 0)).toBe(0);
		expect(navigateDown(5, 0)).toBe(0);
	});

	it("should wrap correctly with single item", () => {
		expect(navigateDown(0, 1)).toBe(0);
	});
});

describe("navigateUp", () => {
	it("should decrement index by 1", () => {
		expect(navigateUp(3, 5)).toBe(2);
		expect(navigateUp(2, 5)).toBe(1);
		expect(navigateUp(1, 5)).toBe(0);
	});

	it("should wrap to end when at start", () => {
		expect(navigateUp(0, 5)).toBe(4);
	});

	it("should return 0 when totalItems is 0", () => {
		expect(navigateUp(0, 0)).toBe(0);
		expect(navigateUp(5, 0)).toBe(0);
	});

	it("should wrap correctly with single item", () => {
		expect(navigateUp(0, 1)).toBe(0);
	});
});

describe("isNavigationKey", () => {
	it("should return true for ArrowDown", () => {
		const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
		expect(isNavigationKey(event)).toBe(true);
	});

	it("should return true for ArrowUp", () => {
		const event = new KeyboardEvent("keydown", { key: "ArrowUp" });
		expect(isNavigationKey(event)).toBe(true);
	});

	it("should return false for other keys", () => {
		const event = new KeyboardEvent("keydown", { key: "Enter" });
		expect(isNavigationKey(event)).toBe(false);
	});

	it("should return false for Escape", () => {
		const event = new KeyboardEvent("keydown", { key: "Escape" });
		expect(isNavigationKey(event)).toBe(false);
	});
});

describe("isSelectionKey", () => {
	it("should return true for Enter", () => {
		const event = new KeyboardEvent("keydown", { key: "Enter" });
		expect(isSelectionKey(event)).toBe(true);
	});

	it("should return true for Tab", () => {
		const event = new KeyboardEvent("keydown", { key: "Tab" });
		expect(isSelectionKey(event)).toBe(true);
	});

	it("should return false for other keys", () => {
		const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
		expect(isSelectionKey(event)).toBe(false);
	});

	it("should return false for Escape", () => {
		const event = new KeyboardEvent("keydown", { key: "Escape" });
		expect(isSelectionKey(event)).toBe(false);
	});
});

describe("isEscapeKey", () => {
	it("should return true for Escape", () => {
		const event = new KeyboardEvent("keydown", { key: "Escape" });
		expect(isEscapeKey(event)).toBe(true);
	});

	it("should return false for other keys", () => {
		const event = new KeyboardEvent("keydown", { key: "Enter" });
		expect(isEscapeKey(event)).toBe(false);
	});

	it("should return false for ArrowDown", () => {
		const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
		expect(isEscapeKey(event)).toBe(false);
	});
});
