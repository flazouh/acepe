import { describe, expect, it } from "bun:test";

import type { AssistantMessageChunk } from "../../types/assistant-message";

import { groupAssistantChunks } from "../assistant-chunk-grouper";

describe("groupAssistantChunks", () => {
	it("separates thought chunks and groups text independently", () => {
		const chunks: AssistantMessageChunk[] = [
			{ type: "thought", block: { type: "text", text: "Hi" } },
			{ type: "thought", block: { type: "text", text: " there" } },
			{ type: "message", block: { type: "text", text: "Hello" } },
			{ type: "message", block: { type: "text", text: " world" } },
			{ type: "thought", block: { type: "text", text: "!" } },
		];

		const grouped = groupAssistantChunks(chunks);

		expect(grouped.thoughtGroups).toEqual([{ type: "text", text: "Hi there!" }]);
		expect(grouped.messageGroups).toEqual([{ type: "text", text: "Hello world" }]);
	});

	it("preserves non-text blocks in the correct group", () => {
		const chunks: AssistantMessageChunk[] = [
			{ type: "thought", block: { type: "text", text: "Thinking" } },
			{ type: "message", block: { type: "resource_link", uri: "app://file", name: "file" } },
			{ type: "thought", block: { type: "image", data: "abc", mimeType: "image/png" } },
		];

		const grouped = groupAssistantChunks(chunks);

		expect(grouped.thoughtGroups).toEqual([
			{ type: "text", text: "Thinking" },
			{ type: "other", block: { type: "image", data: "abc", mimeType: "image/png" } },
		]);
		expect(grouped.messageGroups).toEqual([
			{ type: "other", block: { type: "resource_link", uri: "app://file", name: "file" } },
		]);
	});
});
