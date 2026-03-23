import { describe, expect, it } from "bun:test";

import { sanitizeAssistantText } from "../assistant-text-sanitizer";

describe("sanitizeAssistantText", () => {
	it("strips the deciding response approach header when bold", () => {
		const input = "**Deciding response approach**You're all set to go.";
		expect(sanitizeAssistantText(input)).toBe("You're all set to go.");
	});

	it("strips the deciding response approach header without bold", () => {
		const input = "Deciding response approach: You're all set.";
		expect(sanitizeAssistantText(input)).toBe("You're all set.");
	});

	it("returns original text when no header is present", () => {
		const input = "Hello there.";
		expect(sanitizeAssistantText(input)).toBe("Hello there.");
	});

	it("returns empty when text is only the header", () => {
		const input = " **Deciding response approach** ";
		expect(sanitizeAssistantText(input)).toBe("");
	});
});
