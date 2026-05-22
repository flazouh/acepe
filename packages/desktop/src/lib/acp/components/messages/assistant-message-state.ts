import {
	groupAssistantChunks,
	type ChunkGroup,
	type GroupedAssistantChunks,
} from "../../logic/assistant-chunk-grouper.js";
import { sanitizeAssistantText } from "../../logic/assistant-text-sanitizer.js";
import type { AssistantMessage } from "../../types/assistant-message.js";

export const EMPTY_ASSISTANT_MESSAGE: AssistantMessage = {
	chunks: [],
};

export interface AssistantMessageDisplayState {
	safeMessage: AssistantMessage;
	groupedChunks: GroupedAssistantChunks;
	filteredThoughtGroups: ChunkGroup[];
	textContent: string;
	lastThoughtTextGroupIndex: number;
	lastMessageTextGroupIndex: number;
	hasThinking: boolean;
	hasMessageContent: boolean;
	hasAnyContent: boolean;
	showThinkingBlock: boolean;
	visibleMessageGroups: ChunkGroup[];
	thinkingHeaderLabel: string;
}

export function resolveAssistantMessage(
	candidate: AssistantMessage | undefined,
	onInvalid?: (candidate: AssistantMessage | undefined) => void
): AssistantMessage {
	if (candidate && Array.isArray(candidate.chunks)) {
		return candidate;
	}

	onInvalid?.(candidate);
	return EMPTY_ASSISTANT_MESSAGE;
}

export function buildAssistantMessageDisplayState(input: {
	message: AssistantMessage | undefined;
	isStreaming: boolean;
	onInvalidMessage?: (candidate: AssistantMessage | undefined) => void;
}): AssistantMessageDisplayState {
	const safeMessage = resolveAssistantMessage(input.message, input.onInvalidMessage);
	const groupedChunks = getAssistantGroupedChunks(safeMessage);
	const filteredThoughtGroups = filterAssistantThoughtGroups(
		groupedChunks.thoughtGroups,
		groupedChunks.messageGroups.length > 0
	);

	return {
		safeMessage,
		groupedChunks,
		filteredThoughtGroups,
		textContent: getAssistantTextContent(groupedChunks.messageGroups),
		lastThoughtTextGroupIndex: getLastTextGroupIndex(filteredThoughtGroups),
		lastMessageTextGroupIndex: getLastTextGroupIndex(groupedChunks.messageGroups),
		hasThinking: filteredThoughtGroups.length > 0,
		hasMessageContent: groupedChunks.messageGroups.length > 0,
		hasAnyContent: filteredThoughtGroups.length > 0 || groupedChunks.messageGroups.length > 0,
		showThinkingBlock: filteredThoughtGroups.length > 0,
		visibleMessageGroups: groupedChunks.messageGroups,
		thinkingHeaderLabel: getThinkingHeaderLabel({
			isStreaming: input.isStreaming,
			thinkingDurationMs: safeMessage.thinkingDurationMs,
		}),
	};
}

export function getAssistantGroupedChunks(message: AssistantMessage): GroupedAssistantChunks {
	const grouped = groupAssistantChunks(message.chunks);
	if (grouped.messageGroups.length === 0 || grouped.messageGroups[0]?.type !== "text") {
		return grouped;
	}

	const [firstGroup, ...restGroups] = grouped.messageGroups;
	const sanitized = sanitizeAssistantText(firstGroup.text);

	return {
		messageGroups:
			sanitized.length === 0 ? restGroups : [{ type: "text", text: sanitized }, ...restGroups],
		thoughtGroups: grouped.thoughtGroups,
	};
}

export function filterAssistantThoughtGroups(
	thoughtGroups: ChunkGroup[],
	hasMessageGroups: boolean
): ChunkGroup[] {
	return thoughtGroups.filter((group) => {
		if (group.type !== "text") return true;
		const trimmed = group.text.trim();
		if (trimmed.length === 0) return false;
		if (hasMessageGroups && !/[A-Za-z0-9]/.test(trimmed)) {
			return false;
		}
		return true;
	});
}

export function getAssistantTextContent(messageGroups: ChunkGroup[]): string {
	return messageGroups
		.filter((group): group is Extract<ChunkGroup, { type: "text" }> => group.type === "text")
		.map((group) => group.text)
		.join("");
}

export function getLastTextGroupIndex(groups: ChunkGroup[]): number {
	for (let index = groups.length - 1; index >= 0; index -= 1) {
		if (groups[index]?.type === "text") {
			return index;
		}
	}

	return -1;
}

export function getThinkingHeaderLabel(input: {
	isStreaming: boolean;
	thinkingDurationMs: number | undefined;
}): string {
	const ms = input.thinkingDurationMs;
	if (input.isStreaming && ms != null && ms >= 0) {
		return `Thinking for ${String(getThinkingSeconds(ms))}s`;
	}
	if (input.isStreaming) return "Thinking";
	if (ms != null && ms >= 0) {
		return `Thought for ${String(getThinkingSeconds(ms))}s`;
	}
	return "Thought";
}

function getThinkingSeconds(ms: number): number {
	const seconds = Math.round(ms / 1000);
	return seconds <= 1 ? 1 : seconds;
}
