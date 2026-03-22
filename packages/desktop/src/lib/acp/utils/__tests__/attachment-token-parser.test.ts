import { describe, expect, it } from "vitest";

import { hasAttachmentTokens, parseAttachmentTokens } from "../attachment-token-parser.js";

describe("parseAttachmentTokens", () => {
	it("parses image tokens", () => {
		const text = "@[image:/path/to/image.png] Hello world";
		const result = parseAttachmentTokens(text);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0]).toEqual({
			type: "image",
			path: "/path/to/image.png",
			displayName: "image.png",
			extension: "png",
		});
		expect(result.textWithoutAttachments).toBe("Hello world");
	});

	it("parses file tokens", () => {
		const text = "@[file:/path/to/code.ts] Check this";
		const result = parseAttachmentTokens(text);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0]).toEqual({
			type: "file",
			path: "/path/to/code.ts",
			displayName: "code.ts",
			extension: "ts",
		});
		expect(result.textWithoutAttachments).toBe("Check this");
	});

	it("parses command tokens", () => {
		const text = "@[command:/review] Check this";
		const result = parseAttachmentTokens(text);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0]).toEqual({
			type: "command",
			path: "/review",
			displayName: "/review",
			extension: "cmd",
		});
		expect(result.textWithoutAttachments).toBe("Check this");
	});

	it("parses skill tokens", () => {
		const text = "@[skill:/Plan_review] Check this";
		const result = parseAttachmentTokens(text);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0]).toEqual({
			type: "skill",
			path: "/Plan_review",
			displayName: "Plan_review",
			extension: "skill",
		});
		expect(result.textWithoutAttachments).toBe("Check this");
	});

	it("parses text tokens with content map", () => {
		const contentMap = new Map([["abc123", "line1\nline2\nline3\nline4\nline5"]]);
		const text = "@[text:abc123] Here is some context";
		const result = parseAttachmentTokens(text, contentMap);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].type).toBe("text");
		expect(result.attachments[0].displayName).toBe("Pasted text (5 lines)");
		expect(result.attachments[0].content).toBe("line1\nline2\nline3\nline4\nline5");
		expect(result.textWithoutAttachments).toBe("Here is some context");
	});

	it("parses text tokens without content map", () => {
		const text = "@[text:abc123] Here is some context";
		const result = parseAttachmentTokens(text);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].type).toBe("text");
		expect(result.attachments[0].displayName).toBe("Pasted text (0 lines)");
		expect(result.attachments[0].content).toBeUndefined();
	});

	it("parses multiple mixed tokens", () => {
		const contentMap = new Map([["id1", "content"]]);
		const text = "@[image:/img.png] @[text:id1] @[file:/file.rs] Message";
		const result = parseAttachmentTokens(text, contentMap);

		expect(result.attachments).toHaveLength(3);
		expect(result.attachments[0].type).toBe("image");
		expect(result.attachments[1].type).toBe("text");
		expect(result.attachments[2].type).toBe("file");
		expect(result.textWithoutAttachments).toBe("Message");
	});

	it("returns empty attachments for plain text", () => {
		const text = "Just some plain text without any attachments";
		const result = parseAttachmentTokens(text);

		expect(result.attachments).toHaveLength(0);
		expect(result.textWithoutAttachments).toBe("Just some plain text without any attachments");
	});

	it("handles text token with single line content", () => {
		const contentMap = new Map([["single", "just one line"]]);
		const text = "@[text:single] Check this";
		const result = parseAttachmentTokens(text, contentMap);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].displayName).toBe("Pasted text (1 lines)");
		expect(result.attachments[0].content).toBe("just one line");
	});

	it("handles text token with empty content in map", () => {
		const contentMap = new Map([["empty", ""]]);
		const text = "@[text:empty] Here";
		const result = parseAttachmentTokens(text, contentMap);

		expect(result.attachments).toHaveLength(1);
		// Empty string is falsy, so line count is 0
		expect(result.attachments[0].displayName).toBe("Pasted text (0 lines)");
		expect(result.attachments[0].content).toBe("");
	});

	it("handles text token with ID not in content map", () => {
		const contentMap = new Map([["other", "content"]]);
		const text = "@[text:missing] Here";
		const result = parseAttachmentTokens(text, contentMap);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].displayName).toBe("Pasted text (0 lines)");
		expect(result.attachments[0].content).toBeUndefined();
	});

	it("handles file without extension", () => {
		const text = "@[file:/path/to/Makefile] Check this";
		const result = parseAttachmentTokens(text);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0]).toEqual({
			type: "file",
			path: "/path/to/Makefile",
			displayName: "Makefile",
			extension: "",
		});
	});

	it("handles tokens only without additional text", () => {
		const text = "@[image:/img.png] @[file:/code.ts]";
		const result = parseAttachmentTokens(text);

		expect(result.attachments).toHaveLength(2);
		expect(result.textWithoutAttachments).toBe("");
	});

	it("handles text token with multiline content", () => {
		const content = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
		const contentMap = new Map([["multi", content]]);
		const text = "@[text:multi]";
		const result = parseAttachmentTokens(text, contentMap);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].displayName).toBe("Pasted text (10 lines)");
		expect(result.attachments[0].extension).toBe("txt");
		expect(result.attachments[0].path).toBe("");
	});

	it("handles multiple text tokens with different IDs", () => {
		const contentMap = new Map([
			["id1", "first content"],
			["id2", "second\ncontent"],
		]);
		const text = "@[text:id1] middle @[text:id2] end";
		const result = parseAttachmentTokens(text, contentMap);

		expect(result.attachments).toHaveLength(2);
		expect(result.attachments[0].content).toBe("first content");
		expect(result.attachments[0].displayName).toBe("Pasted text (1 lines)");
		expect(result.attachments[1].content).toBe("second\ncontent");
		expect(result.attachments[1].displayName).toBe("Pasted text (2 lines)");
		expect(result.textWithoutAttachments).toBe("middle  end");
	});
});

describe("hasAttachmentTokens", () => {
	it("returns true for image tokens", () => {
		expect(hasAttachmentTokens("@[image:/path.png] text")).toBe(true);
	});

	it("returns true for file tokens", () => {
		expect(hasAttachmentTokens("@[file:/path.ts] text")).toBe(true);
	});

	it("returns true for text tokens", () => {
		expect(hasAttachmentTokens("@[text:abc] text")).toBe(true);
	});

	it("returns true for command tokens", () => {
		expect(hasAttachmentTokens("@[command:/review] text")).toBe(true);
	});

	it("returns true for skill tokens", () => {
		expect(hasAttachmentTokens("@[skill:/Plan_review] text")).toBe(true);
	});

	it("returns false for plain text", () => {
		expect(hasAttachmentTokens("plain text")).toBe(false);
	});

	it("returns false for malformed tokens", () => {
		expect(hasAttachmentTokens("@[invalid:token")).toBe(false);
	});
});
