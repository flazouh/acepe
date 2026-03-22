import { describe, expect, it } from "bun:test";

import {
	hasAutocompleteTrigger,
	parseFilePickerTrigger,
	parseSlashCommandTrigger,
} from "../input-parser.js";

describe("parseFilePickerTrigger", () => {
	it("should return null when no @ found", () => {
		const result = parseFilePickerTrigger("Hello world", 11);
		expect(result.isOk()).toBe(true);

		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});

	it("should return null when @ is in the middle of a word", () => {
		const result = parseFilePickerTrigger("Hello@world", 11);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});

	it("should return trigger when @ is at start", () => {
		const result = parseFilePickerTrigger("@file", 5);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.startIndex).toBe(0);
				expect(result.value.query).toBe("file");
			}
		}
	});

	it("should return trigger when @ is after space", () => {
		const result = parseFilePickerTrigger("Hello @file", 11);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.startIndex).toBe(6);
				expect(result.value.query).toBe("file");
			}
		}
	});

	it("should return trigger when @ is after newline", () => {
		const result = parseFilePickerTrigger("Hello\n@file", 11);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.startIndex).toBe(6);
				expect(result.value.query).toBe("file");
			}
		}
	});

	it("should return null when space after @", () => {
		const result = parseFilePickerTrigger("Hello @ file", 12);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});

	it("should return null when @ is followed by space immediately", () => {
		const result = parseFilePickerTrigger("Hello @ ", 8);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});

	it("should return error for invalid cursor position (negative)", () => {
		const result = parseFilePickerTrigger("Hello", -1);
		expect(result.isErr()).toBe(true);
	});

	it("should return error for invalid cursor position (beyond length)", () => {
		const result = parseFilePickerTrigger("Hello", 10);
		expect(result.isErr()).toBe(true);
	});

	it("should handle empty query", () => {
		const result = parseFilePickerTrigger("Hello @", 7);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.query).toBe("");
			}
		}
	});

	it("should handle multiple @ symbols and use the last one", () => {
		const result = parseFilePickerTrigger("Hello @old @new", 15);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.startIndex).toBe(11);
				expect(result.value.query).toBe("new");
			}
		}
	});

	it("should ignore @ inside inline artefact token", () => {
		const result = parseFilePickerTrigger("Use @[text_ref:abc-123]", 22);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});
});

describe("hasAutocompleteTrigger", () => {
	it("returns false for plain text without trigger characters", () => {
		expect(hasAutocompleteTrigger("hello world")).toBe(false);
		expect(hasAutocompleteTrigger("")).toBe(false);
	});

	it("returns true when message includes @ trigger", () => {
		expect(hasAutocompleteTrigger("hello @")).toBe(true);
	});

	it("returns true when message includes / trigger", () => {
		expect(hasAutocompleteTrigger("run /review")).toBe(true);
	});

	it("returns true for inline artefact tokens containing @", () => {
		expect(hasAutocompleteTrigger("hello @[file:src/main.ts] world")).toBe(true);
	});

	it("returns true for messages with URLs containing /", () => {
		expect(hasAutocompleteTrigger("visit https://example.com")).toBe(true);
	});
});

describe("parseSlashCommandTrigger", () => {
	it("should return null when no / found", () => {
		const result = parseSlashCommandTrigger("Hello world", 11);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});

	it("should return null when / is in the middle of a word", () => {
		const result = parseSlashCommandTrigger("Hello/world", 11);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});

	it("should return trigger when / is at start", () => {
		const result = parseSlashCommandTrigger("/cmd", 4);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.startIndex).toBe(0);
				expect(result.value.query).toBe("cmd");
			}
		}
	});

	it("should return trigger when / is after space", () => {
		const result = parseSlashCommandTrigger("Hello /cmd", 10);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.startIndex).toBe(6);
				expect(result.value.query).toBe("cmd");
			}
		}
	});

	it("should return trigger when / is after newline", () => {
		const result = parseSlashCommandTrigger("Hello\n/cmd", 10);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.startIndex).toBe(6);
				expect(result.value.query).toBe("cmd");
			}
		}
	});

	it("should return null when space after /", () => {
		const result = parseSlashCommandTrigger("Hello / cmd", 11);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});

	it("should return null when / is followed by space immediately", () => {
		const result = parseSlashCommandTrigger("Hello / ", 8);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});

	it("should return error for invalid cursor position (negative)", () => {
		const result = parseSlashCommandTrigger("Hello", -1);
		expect(result.isErr()).toBe(true);
	});

	it("should return error for invalid cursor position (beyond length)", () => {
		const result = parseSlashCommandTrigger("Hello", 10);
		expect(result.isErr()).toBe(true);
	});

	it("should handle empty query", () => {
		const result = parseSlashCommandTrigger("Hello /", 7);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.query).toBe("");
			}
		}
	});

	it("should handle multiple / symbols and use the last one", () => {
		const result = parseSlashCommandTrigger("Hello /old /new", 15);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBe(null);
			if (result.value) {
				expect(result.value.startIndex).toBe(11);
				expect(result.value.query).toBe("new");
			}
		}
	});

	it("should ignore / inside inline artefact token", () => {
		const result = parseSlashCommandTrigger("Run @[command:/review-commit]", 28);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(null);
		}
	});
});
