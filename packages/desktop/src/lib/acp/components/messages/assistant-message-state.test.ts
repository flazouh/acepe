import { describe, expect, it } from "bun:test";

import type { AssistantMessage } from "../../types/assistant-message.js";

import {
	buildAssistantMessageDisplayState,
	filterAssistantThoughtGroups,
	getAssistantTextContent,
	getLastTextGroupIndex,
	getThinkingHeaderLabel,
	resolveAssistantMessage,
} from "./assistant-message-state.js";

function makeMessage(chunks: AssistantMessage["chunks"], thinkingDurationMs?: number): AssistantMessage {
	return { chunks, thinkingDurationMs };
}

describe("assistant-message-state", () => {
	it("builds display state with sanitized message text and filtered thought tails", () => {
		const state = buildAssistantMessageDisplayState({
			isStreaming: true,
			message: makeMessage(
				[
					{ type: "thought", block: { type: "text", text: "working" } },
					{ type: "thought", block: { type: "text", text: "..." } },
					{
						type: "message",
						block: { type: "text", text: "Deciding response approach: hello" },
					},
					{ type: "message", block: { type: "text", text: " world" } },
				],
				2300
			),
		});

		expect(state.hasAnyContent).toBe(true);
		expect(state.hasThinking).toBe(true);
		expect(state.hasMessageContent).toBe(true);
		expect(state.showThinkingBlock).toBe(true);
		expect(state.textContent).toBe("hello world");
		expect(state.filteredThoughtGroups).toEqual([{ type: "text", text: "working..." }]);
		expect(state.lastThoughtTextGroupIndex).toBe(0);
		expect(state.lastMessageTextGroupIndex).toBe(0);
		expect(state.thinkingHeaderLabel).toBe("Thinking for 2s");
	});

	it("keeps non-text thought groups while filtering blank text", () => {
		const groups = filterAssistantThoughtGroups(
			[
				{ type: "text", text: " " },
				{ type: "other", block: { type: "image", data: "abc", mimeType: "image/png" } },
			],
			false
		);

		expect(groups).toEqual([
			{ type: "other", block: { type: "image", data: "abc", mimeType: "image/png" } },
		]);
	});

	it("joins only assistant text message groups", () => {
		expect(
			getAssistantTextContent([
				{ type: "text", text: "one" },
				{ type: "other", block: { type: "image", data: "abc", mimeType: "image/png" } },
				{ type: "text", text: " two" },
			])
		).toBe("one two");
	});

	it("finds the last text group index", () => {
		expect(
			getLastTextGroupIndex([
				{ type: "text", text: "first" },
				{ type: "other", block: { type: "image", data: "abc", mimeType: "image/png" } },
				{ type: "text", text: "last" },
			])
		).toBe(2);
		expect(getLastTextGroupIndex([{ type: "other", block: { type: "text", text: "runtime" } }])).toBe(
			-1
		);
	});

	it("builds thinking header labels", () => {
		expect(getThinkingHeaderLabel({ isStreaming: true, thinkingDurationMs: undefined })).toBe(
			"Thinking"
		);
		expect(getThinkingHeaderLabel({ isStreaming: true, thinkingDurationMs: 100 })).toBe(
			"Thinking for 1s"
		);
		expect(getThinkingHeaderLabel({ isStreaming: false, thinkingDurationMs: 2400 })).toBe(
			"Thought for 2s"
		);
		expect(getThinkingHeaderLabel({ isStreaming: false, thinkingDurationMs: undefined })).toBe(
			"Thought"
		);
	});

	it("falls back for invalid assistant messages", () => {
		let invalidWasReported = false;
		const message = resolveAssistantMessage(undefined, () => {
			invalidWasReported = true;
		});

		expect(message.chunks).toEqual([]);
		expect(invalidWasReported).toBe(true);
	});
});
