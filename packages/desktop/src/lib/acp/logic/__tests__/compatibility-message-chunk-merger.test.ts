import { describe, expect, it } from "vitest";

import { CompatibilityMessageChunkMerger } from "../compatibility-message-chunk-merger.js";

describe("CompatibilityMessageChunkMerger", () => {
	it("merges user text chunks", () => {
		const merger = new CompatibilityMessageChunkMerger();

		const result = merger.mergeUserMessageChunk(
			{
				content: { type: "text", text: "Hello" },
				chunks: [{ type: "text", text: "Hello" }],
			},
			{
				content: { type: "text", text: " world" },
			}
		);

		expect(result).toEqual({
			content: { type: "text", text: "Hello world" },
			chunks: [
				{ type: "text", text: "Hello" },
				{ type: "text", text: " world" },
			],
		});
	});

	it("merges assistant message chunks", () => {
		const merger = new CompatibilityMessageChunkMerger();

		const result = merger.mergeAssistantMessageChunk(
			{
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Hello" },
					},
				],
			},
			{
				content: { type: "text", text: " world" },
			},
			false
		);

		expect(result).toEqual({
			chunks: [
				{
					type: "message",
					block: { type: "text", text: "Hello" },
				},
				{
					type: "message",
					block: { type: "text", text: " world" },
				},
			],
		});
	});

	it("normalizes thought prefixes only for thought chunks", () => {
		const merger = new CompatibilityMessageChunkMerger();

		const thoughtResult = merger.mergeAssistantMessageChunk(
			{ chunks: [] },
			{
				content: { type: "text", text: "[Thinking] I need to analyze this." },
			},
			true
		);
		const messageResult = merger.mergeAssistantMessageChunk(
			{ chunks: [] },
			{
				content: { type: "text", text: "[Thinking] This is visible text" },
			},
			false
		);

		expect(thoughtResult).toEqual({
			chunks: [
				{
					type: "thought",
					block: { type: "text", text: "I need to analyze this." },
				},
			],
		});
		expect(messageResult).toEqual({
			chunks: [
				{
					type: "message",
					block: { type: "text", text: "[Thinking] This is visible text" },
				},
			],
		});
	});
});
