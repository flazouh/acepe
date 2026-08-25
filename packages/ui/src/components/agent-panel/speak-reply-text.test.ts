import { describe, expect, it } from "bun:test";

import { prepareSpokenReplyText } from "./speak-reply-text.js";

describe("prepareSpokenReplyText", () => {
	it("returns null when the reply is only whitespace", () => {
		expect(prepareSpokenReplyText("   \n\t  ")).toBeNull();
	});

	it("collapses whitespace and trims the reply", () => {
		expect(prepareSpokenReplyText("  Hello,\n\nworld.  ")).toBe("Hello, world.");
	});

	it("caps a long reply at 8000 characters", () => {
		const spoken = prepareSpokenReplyText(`${"a".repeat(8001)} extra`);
		expect(spoken).not.toBeNull();
		expect(spoken?.length).toBe(8000);
	});
});
