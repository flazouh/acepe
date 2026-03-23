import { describe, expect, it } from "bun:test";

import { validateMessage } from "../message-validator.js";

describe("validateMessage", () => {
	it("should return error when message is not a string", () => {
		const result = validateMessage(null as unknown as string);
		expect(result.isErr()).toBe(true);
	});

	it("should return error when message is empty string", () => {
		const result = validateMessage("");
		expect(result.isErr()).toBe(true);
	});

	it("should return error when message is only whitespace", () => {
		const result = validateMessage("   ");
		expect(result.isErr()).toBe(true);
	});

	it("should return error when message is only newlines", () => {
		const result = validateMessage("\n\n\n");
		expect(result.isErr()).toBe(true);
	});

	it("should return error when message is only tabs", () => {
		const result = validateMessage("\t\t\t");
		expect(result.isErr()).toBe(true);
	});

	it("should return trimmed message when message has leading whitespace", () => {
		const result = validateMessage("  Hello");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Hello");
		}
	});

	it("should return trimmed message when message has trailing whitespace", () => {
		const result = validateMessage("Hello  ");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Hello");
		}
	});

	it("should return trimmed message when message has both leading and trailing whitespace", () => {
		const result = validateMessage("  Hello  ");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Hello");
		}
	});

	it("should return message when message has no whitespace", () => {
		const result = validateMessage("Hello");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Hello");
		}
	});

	it("should preserve internal whitespace", () => {
		const result = validateMessage("Hello  world");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Hello  world");
		}
	});

	it("should handle multiline messages", () => {
		const result = validateMessage("Hello\nworld");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Hello\nworld");
		}
	});

	it("should handle messages with special characters", () => {
		const result = validateMessage("Hello @world /cmd");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Hello @world /cmd");
		}
	});

	it("should handle single character messages", () => {
		const result = validateMessage("H");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("H");
		}
	});
});
