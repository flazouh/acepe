import { describe, expect, it } from "bun:test";

import { prepareMessageForSend } from "../message-preparation.js";

describe("prepareMessageForSend", () => {
	it("returns validated content for plain text", () => {
		const result = prepareMessageForSend("Hello world", new Map(), []);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toBe("Hello world");
		}
	});

	it("returns error for empty message", () => {
		const result = prepareMessageForSend("", new Map(), []);
		expect(result.isErr()).toBe(true);
	});

	it("returns error for whitespace-only message", () => {
		const result = prepareMessageForSend("   ", new Map(), []);
		expect(result.isErr()).toBe(true);
	});

	it("expands @[text_ref:UUID] tokens to @[text:BASE64]", () => {
		const textMap = new Map([["abc-123", "Hello from pasted text"]]);
		const result = prepareMessageForSend("Check this: @[text_ref:abc-123]", textMap, []);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toContain("@[text:");
			expect(result.value.content).not.toContain("@[text_ref:");
			// Decode the base64 to verify round-trip
			const match = result.value.content.match(/@\[text:([^\]]+)\]/);
			expect(match).not.toBeNull();
			const decoded = decodeURIComponent(escape(atob(match![1])));
			expect(decoded).toBe("Hello from pasted text");
		}
	});

	it("handles multiple text_ref tokens", () => {
		const textMap = new Map([
			["id-1", "First paste"],
			["id-2", "Second paste"],
		]);
		const result = prepareMessageForSend("@[text_ref:id-1] and @[text_ref:id-2]", textMap, []);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			const matches = result.value.content.match(/@\[text:[^\]]+\]/g);
			expect(matches).toHaveLength(2);
		}
	});

	it("removes unknown text_ref tokens (missing from map)", () => {
		const result = prepareMessageForSend("Before @[text_ref:unknown-id] after", new Map(), []);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toBe("Before  after");
		}
	});

	it("preserves file attachment tokens", () => {
		const result = prepareMessageForSend("@[file:/path/to/file.ts] review this", new Map(), []);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toContain("@[file:/path/to/file.ts]");
		}
	});

	it("handles unicode content in text_ref expansion", () => {
		const textMap = new Map([["uni-id", "Hello 世界 🌍"]]);
		const result = prepareMessageForSend("@[text_ref:uni-id]", textMap, []);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			const match = result.value.content.match(/@\[text:([^\]]+)\]/);
			expect(match).not.toBeNull();
			const decoded = decodeURIComponent(escape(atob(match![1])));
			expect(decoded).toBe("Hello 世界 🌍");
		}
	});

	it("trims whitespace from final content", () => {
		const result = prepareMessageForSend("  Hello  ", new Map(), []);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toBe("Hello");
		}
	});

	it("serializes attachments into the message", () => {
		const attachments = [
			{
				id: "test-1",
				type: "file" as const,
				path: "/src/index.ts",
				displayName: "index.ts",
				extension: "ts",
			},
		];
		const result = prepareMessageForSend("review", new Map(), attachments);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toContain("@[file:/src/index.ts]");
		}
	});

	it("separates clipboard image attachments into imageAttachments", () => {
		const attachments = [
			{
				id: "img-1",
				type: "image" as const,
				path: "",
				displayName: "screenshot.png",
				extension: "png",
				content: "data:image/png;base64,iVBORw0KGgo",
			},
		];
		const result = prepareMessageForSend("check this", new Map(), attachments);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).not.toContain("@[image:");
			expect(result.value.imageAttachments).toHaveLength(1);
			expect(result.value.imageAttachments[0].content).toBe("data:image/png;base64,iVBORw0KGgo");
		}
	});

	it("allows image-only messages (no text)", () => {
		const attachments = [
			{
				id: "img-1",
				type: "image" as const,
				path: "",
				displayName: "screenshot.png",
				extension: "png",
				content: "data:image/png;base64,iVBORw0KGgo",
			},
		];
		const result = prepareMessageForSend("", new Map(), attachments);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toBe("");
			expect(result.value.imageAttachments).toHaveLength(1);
		}
	});

	it("keeps file-drop images with paths as serialized tokens", () => {
		const attachments = [
			{
				id: "img-drop",
				type: "image" as const,
				path: "/Users/alex/screenshot.png",
				displayName: "screenshot.png",
				extension: "png",
				content: "data:image/png;base64,abc",
			},
		];
		const result = prepareMessageForSend("look", new Map(), attachments);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toContain("@[image:/Users/alex/screenshot.png]");
			expect(result.value.imageAttachments).toHaveLength(0);
		}
	});

	it("handles mixed image and file attachments", () => {
		const attachments = [
			{
				id: "img-1",
				type: "image" as const,
				path: "",
				displayName: "paste.png",
				extension: "png",
				content: "data:image/png;base64,iVBORw0KGgo",
			},
			{
				id: "file-1",
				type: "file" as const,
				path: "/src/app.ts",
				displayName: "app.ts",
				extension: "ts",
			},
		];
		const result = prepareMessageForSend("review", new Map(), attachments);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.content).toContain("@[file:/src/app.ts]");
			expect(result.value.content).not.toContain("@[image:");
			expect(result.value.imageAttachments).toHaveLength(1);
		}
	});

	it("returns empty imageAttachments when no images", () => {
		const result = prepareMessageForSend("Hello", new Map(), []);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.imageAttachments).toHaveLength(0);
		}
	});
});
