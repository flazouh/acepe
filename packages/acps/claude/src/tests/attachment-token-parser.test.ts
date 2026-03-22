import { describe, expect, it } from "vitest";

import { expandAttachmentTokens, hasAttachmentTokens } from "../attachment-token-parser.js";

/**
 * Encode text the same way the frontend does:
 * btoa(unescape(encodeURIComponent(content)))
 */
function encodeAsBase64(content: string): string {
	return Buffer.from(content, "utf-8").toString("base64");
}

describe("expandAttachmentTokens", () => {
	it("expands command tokens into slash commands", () => {
		const result = expandAttachmentTokens("@[command:/review] arg1");
		expect(result.expandedText).toBe("/review arg1");
		expect(result.attachments).toEqual([{ type: "command", path: "/review" }]);
	});

	it("expands skill tokens into slash commands", () => {
		const result = expandAttachmentTokens("@[skill:/Plan_review] arg1");
		expect(result.expandedText).toBe("/Plan_review arg1");
		expect(result.attachments).toEqual([{ type: "skill", path: "/Plan_review" }]);
	});

	it("expands base64-encoded text tokens into pasted-content blocks", () => {
		const pastedText = "Hello World";
		const base64 = encodeAsBase64(pastedText);
		const input = `@[text:${base64}]\nPlease review this`;
		const result = expandAttachmentTokens(input);

		expect(result.expandedText).toBe(
			'<pasted-content lines="1">\nHello World\n</pasted-content>\nPlease review this'
		);
		expect(result.attachments).toEqual([{ type: "text", path: "", content: "Hello World" }]);
	});

	it("expands multi-line pasted text with correct line count", () => {
		const pastedText = "line1\nline2\nline3";
		const base64 = encodeAsBase64(pastedText);
		const input = `@[text:${base64}]\ncheck this`;
		const result = expandAttachmentTokens(input);

		expect(result.expandedText).toContain('<pasted-content lines="3">');
		expect(result.expandedText).toContain("line1\nline2\nline3");
		expect(result.attachments[0].content).toBe("line1\nline2\nline3");
	});

	it("preserves dollar signs in pasted content without String.replace corruption", () => {
		const pastedText = "Price is $100 and $& means matched";
		const base64 = encodeAsBase64(pastedText);
		const input = `@[text:${base64}]\nwhat is this?`;
		const result = expandAttachmentTokens(input);

		// String.prototype.replace treats $& as "insert matched substring"
		// This test will FAIL if replace() interprets $ patterns in the decoded content
		expect(result.expandedText).toContain("Price is $100 and $& means matched");
		expect(result.expandedText).not.toContain("@[text:");
	});

	it("preserves $' and $` in pasted content", () => {
		const pastedText = "before $` middle $' after";
		const base64 = encodeAsBase64(pastedText);
		const input = `@[text:${base64}]\nreview`;
		const result = expandAttachmentTokens(input);

		expect(result.expandedText).toContain("before $` middle $' after");
		expect(result.expandedText).not.toContain("@[text:");
	});

	it("handles pasted text with unicode characters", () => {
		const pastedText = "Hello 世界 🌍 café";
		const base64 = encodeAsBase64(pastedText);
		const input = `@[text:${base64}]\ncheck`;
		const result = expandAttachmentTokens(input);

		expect(result.expandedText).toContain("Hello 世界 🌍 café");
	});

	it("expands file tokens into formatted references", () => {
		const result = expandAttachmentTokens("@[file:/path/to/code.ts]\ncheck this");
		expect(result.expandedText).toBe("[Attached file: /path/to/code.ts]\ncheck this");
		expect(result.attachments).toEqual([{ type: "file", path: "/path/to/code.ts" }]);
	});

	it("expands image tokens into formatted references", () => {
		const result = expandAttachmentTokens("@[image:/path/to/img.png]\ncheck this");
		expect(result.expandedText).toBe("[Attached image: /path/to/img.png]\ncheck this");
		expect(result.attachments).toEqual([{ type: "image", path: "/path/to/img.png" }]);
	});
});

describe("hasAttachmentTokens", () => {
	it("detects command tokens", () => {
		expect(hasAttachmentTokens("@[command:/review]")).toBe(true);
	});

	it("detects skill tokens", () => {
		expect(hasAttachmentTokens("@[skill:/Plan_review]")).toBe(true);
	});

	it("detects text tokens", () => {
		expect(hasAttachmentTokens("@[text:SGVsbG8=]")).toBe(true);
	});

	it("detects file tokens", () => {
		expect(hasAttachmentTokens("@[file:/path/to/file.ts]")).toBe(true);
	});

	it("returns false for plain text", () => {
		expect(hasAttachmentTokens("plain text without tokens")).toBe(false);
	});
});
