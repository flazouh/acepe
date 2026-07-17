import { describe, expect, it } from "bun:test";
import { attentionStatusColor } from "../attention-status-color.js";

describe("attentionStatusColor", () => {
	it("maps answer_needed to Cursor warning", () => {
		expect(attentionStatusColor("answer_needed")).toBe("var(--cursor-status-warning)");
	});

	it("maps needs_review to Cursor success", () => {
		expect(attentionStatusColor("needs_review")).toBe("var(--cursor-status-success)");
	});

	it("maps error to Cursor error", () => {
		expect(attentionStatusColor("error")).toBe("var(--cursor-status-error)");
	});
});
