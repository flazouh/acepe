import {
	groupAssistantChunks,
	type ChunkGroup,
	type GroupedAssistantChunks,
} from "../../lib/assistant-message/assistant-chunk-grouper.js";
import { sanitizeAssistantText } from "../../lib/assistant-message/assistant-text-sanitizer.js";
import type { AssistantMessage } from "../../lib/assistant-message/types.js";

export interface AssistantMessageContentFlags {
	hasThinking: boolean;
	hasMessageContent: boolean;
	hasAnyContent: boolean;
	showThinkingBlock: boolean;
}

export function getSanitizedAssistantChunkGroups(
	message: AssistantMessage
): GroupedAssistantChunks {
	const grouped = groupAssistantChunks(message.chunks);

	if (grouped.messageGroups.length > 0 && grouped.messageGroups[0]?.type === "text") {
		const firstGroup = grouped.messageGroups[0];
		const sanitized = sanitizeAssistantText(firstGroup.text);

		if (sanitized.length === 0) {
			grouped.messageGroups = grouped.messageGroups.slice(1);
		} else {
			grouped.messageGroups[0] = { type: "text", text: sanitized };
		}
	}

	return grouped;
}

export function getFilteredAssistantThoughtGroups(input: {
	thoughtGroups: readonly ChunkGroup[];
	hasMessageGroups: boolean;
}): readonly ChunkGroup[] {
	return input.thoughtGroups.filter((group) => {
		if (group.type !== "text") return true;
		const trimmed = group.text.trim();
		if (trimmed.length === 0) return false;
		if (input.hasMessageGroups && !/[A-Za-z0-9]/.test(trimmed)) return false;
		return true;
	});
}

export function getAssistantTextContent(
	messageGroups: readonly ChunkGroup[]
): string {
	return messageGroups
		.filter((group) => group.type === "text")
		.map((group) => group.text)
		.join("");
}

export function findLastTextGroupIndex(groups: readonly ChunkGroup[]): number {
	for (let index = groups.length - 1; index >= 0; index -= 1) {
		if (groups[index]?.type === "text") return index;
	}
	return -1;
}

export function getAssistantMessageContentFlags(input: {
	filteredThoughtGroups: readonly ChunkGroup[];
	messageGroups: readonly ChunkGroup[];
}): AssistantMessageContentFlags {
	const hasThinking = input.filteredThoughtGroups.length > 0;
	const hasMessageContent = input.messageGroups.length > 0;

	return {
		hasThinking,
		hasMessageContent,
		hasAnyContent: hasThinking || hasMessageContent,
		showThinkingBlock: hasThinking,
	};
}

export function getThinkingHeaderLabel(input: {
	isStreaming: boolean;
	thinkingDurationMs?: number;
}): string {
	const ms = input.thinkingDurationMs;
	if (input.isStreaming && ms != null && ms >= 0) {
		const seconds = Math.round(ms / 1000);
		return `Thinking for ${String(seconds <= 1 ? 1 : seconds)}s`;
	}
	if (input.isStreaming) return "Thinking";
	if (ms != null && ms >= 0) {
		const seconds = Math.round(ms / 1000);
		return `Thought for ${String(seconds <= 1 ? 1 : seconds)}s`;
	}
	return "Thought";
}
