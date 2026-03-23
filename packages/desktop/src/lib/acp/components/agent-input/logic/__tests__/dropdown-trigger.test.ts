import { describe, expect, it } from "bun:test";

import { calculateDropdownPosition } from "../dropdown-trigger.js";

describe("calculateDropdownPosition", () => {
	it("should return error when textarea is null", () => {
		const result = calculateDropdownPosition(null as unknown as HTMLTextAreaElement, 0);
		expect(result.isErr()).toBe(true);
	});

	it("should return error for invalid trigger index (negative)", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "Hello";
		const result = calculateDropdownPosition(textarea, -1);
		expect(result.isErr()).toBe(true);
	});

	it("should return error for invalid trigger index (beyond length)", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "Hello";
		const result = calculateDropdownPosition(textarea, 10);
		expect(result.isErr()).toBe(true);
	});

	it("should calculate position at start of text", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "Hello world";
		textarea.style.position = "absolute";
		textarea.style.top = "100px";
		textarea.style.left = "200px";
		document.body.appendChild(textarea);

		const result = calculateDropdownPosition(textarea, 0);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.top).toBeGreaterThanOrEqual(0);
			expect(result.value.left).toBeGreaterThanOrEqual(0);
		}

		document.body.removeChild(textarea);
	});

	it("should calculate position at end of text", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "Hello world";
		textarea.style.position = "absolute";
		textarea.style.top = "100px";
		textarea.style.left = "200px";
		document.body.appendChild(textarea);

		const result = calculateDropdownPosition(textarea, textarea.value.length);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.top).toBeGreaterThanOrEqual(0);
			expect(result.value.left).toBeGreaterThanOrEqual(0);
		}

		document.body.removeChild(textarea);
	});

	it("should calculate position in middle of text", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "Hello world";
		textarea.style.position = "absolute";
		textarea.style.top = "100px";
		textarea.style.left = "200px";
		document.body.appendChild(textarea);

		const result = calculateDropdownPosition(textarea, 5);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.top).toBeGreaterThanOrEqual(0);
			expect(result.value.left).toBeGreaterThanOrEqual(0);
		}

		document.body.removeChild(textarea);
	});

	it("should handle empty textarea", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "";
		textarea.style.position = "absolute";
		textarea.style.top = "100px";
		textarea.style.left = "200px";
		document.body.appendChild(textarea);

		const result = calculateDropdownPosition(textarea, 0);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.top).toBeGreaterThanOrEqual(0);
			expect(result.value.left).toBeGreaterThanOrEqual(0);
		}

		document.body.removeChild(textarea);
	});
});
