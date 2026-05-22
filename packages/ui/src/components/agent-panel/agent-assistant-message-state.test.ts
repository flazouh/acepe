import { describe, expect, test } from "bun:test";
import {
	findLastTextGroupIndex,
	getAssistantMessageContentFlags,
	getAssistantTextContent,
	getFilteredAssistantThoughtGroups,
	getSanitizedAssistantChunkGroups,
	getThinkingHeaderLabel,
} from "./agent-assistant-message-state.js";
import type { ChunkGroup } from "../../lib/assistant-message/assistant-chunk-grouper.js";
import type { AssistantMessage } from "../../lib/assistant-message/types.js";

describe("agent assistant message state", () => {
	test("sanitizes leading assistant text group and drops it when empty", () => {
		const message: AssistantMessage = {
			chunks: [
				{ type: "message", block: { type: "text", text: "\n\n" } },
				{
					type: "message",
					block: { type: "resource", resource: { uri: "file://a" } },
				},
			],
		};

		expect(getSanitizedAssistantChunkGroups(message).messageGroups).toEqual([
			{ type: "other", block: { type: "resource", resource: { uri: "file://a" } } },
		]);
	});

	test("filters empty thought groups and punctuation-only thoughts after message content", () => {
		const thoughtGroups: readonly ChunkGroup[] = [
			{ type: "text", text: "   " },
			{ type: "text", text: "..." },
			{ type: "text", text: "real thought" },
			{ type: "other", block: { type: "resource", resource: { uri: "file://b" } } },
		];

		expect(
			getFilteredAssistantThoughtGroups({
				thoughtGroups,
				hasMessageGroups: true,
			})
		).toEqual([
			{ type: "text", text: "real thought" },
			{ type: "other", block: { type: "resource", resource: { uri: "file://b" } } },
		]);
		expect(
			getFilteredAssistantThoughtGroups({
				thoughtGroups,
				hasMessageGroups: false,
			})
		).toEqual([
			{ type: "text", text: "..." },
			{ type: "text", text: "real thought" },
			{ type: "other", block: { type: "resource", resource: { uri: "file://b" } } },
		]);
	});

	test("joins assistant text content and finds last text group", () => {
		const groups: readonly ChunkGroup[] = [
			{ type: "text", text: "hello " },
			{ type: "other", block: { type: "resource", resource: { uri: "file://a" } } },
			{ type: "text", text: "world" },
		];

		expect(getAssistantTextContent(groups)).toBe("hello world");
		expect(findLastTextGroupIndex(groups)).toBe(2);
		expect(
			findLastTextGroupIndex([
				{ type: "other", block: { type: "resource", resource: { uri: "file://a" } } },
			])
		).toBe(-1);
	});

	test("builds content flags", () => {
		expect(
			getAssistantMessageContentFlags({
				filteredThoughtGroups: [],
				messageGroups: [],
			})
		).toEqual({
			hasThinking: false,
			hasMessageContent: false,
			hasAnyContent: false,
			showThinkingBlock: false,
		});
		expect(
			getAssistantMessageContentFlags({
				filteredThoughtGroups: [{ type: "text", text: "thinking" }],
				messageGroups: [],
			})
		).toEqual({
			hasThinking: true,
			hasMessageContent: false,
			hasAnyContent: true,
			showThinkingBlock: true,
		});
	});

	test("formats thinking header label", () => {
		expect(getThinkingHeaderLabel({ isStreaming: true, thinkingDurationMs: 500 })).toBe(
			"Thinking for 1s"
		);
		expect(getThinkingHeaderLabel({ isStreaming: true, thinkingDurationMs: 2400 })).toBe(
			"Thinking for 2s"
		);
		expect(getThinkingHeaderLabel({ isStreaming: true })).toBe("Thinking");
		expect(getThinkingHeaderLabel({ isStreaming: false, thinkingDurationMs: 400 })).toBe(
			"Thought for 1s"
		);
		expect(getThinkingHeaderLabel({ isStreaming: false })).toBe("Thought");
	});
});
