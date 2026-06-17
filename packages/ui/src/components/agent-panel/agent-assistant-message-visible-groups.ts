import type { ChunkGroup } from "../../lib/assistant-message/assistant-chunk-grouper.js";
import type { TokenRevealCss } from "./types.js";

function resolveCurrentStreamingGroupIndex(
	messageGroups: readonly ChunkGroup[],
	revealedCharCount: number
): number {
	if (revealedCharCount <= 0) {
		return -1;
	}

	let consumedChars = 0;
	for (let index = 0; index < messageGroups.length; index += 1) {
		const group = messageGroups[index];
		if (group?.type !== "text") {
			continue;
		}

		consumedChars += group.text.length;
		if (revealedCharCount <= consumedChars) {
			return index;
		}
	}

	return messageGroups.length - 1;
}

export function resolveVisibleAssistantMessageGroups(input: {
	readonly messageGroups: readonly ChunkGroup[];
	readonly isStreaming?: boolean;
	readonly tokenRevealCss?: TokenRevealCss;
	readonly lastMessageTextGroupIndex: number;
}): ChunkGroup[] {
	if (
		input.lastMessageTextGroupIndex < 0 ||
		input.isStreaming !== true ||
		input.tokenRevealCss === undefined
	) {
		return input.messageGroups.slice();
	}

	const currentGroupIndex = resolveCurrentStreamingGroupIndex(
		input.messageGroups,
		input.tokenRevealCss.revealedCharCount
	);
	if (currentGroupIndex < 0) {
		return [];
	}

	return input.messageGroups.slice(0, currentGroupIndex + 1);
}

export function shouldStreamAssistantTextContent(input: {
	readonly isStreaming?: boolean;
	readonly tokenRevealCss?: TokenRevealCss;
}): boolean {
	return input.isStreaming === true && input.tokenRevealCss === undefined;
}

export function shouldStreamAssistantThoughtContent(input: {
	readonly isStreaming?: boolean;
	readonly hasMessageContent: boolean;
	readonly isLastThoughtTextGroup: boolean;
}): boolean {
	return (
		input.isStreaming === true &&
		!input.hasMessageContent &&
		input.isLastThoughtTextGroup
	);
}

/**
 * Token-reveal timing for a thinking thought group. While the model is still
 * thinking (streaming, before any message content), the canonical active
 * streaming tail IS the thought row, so the entry's `activeTokenRevealCss`
 * describes the thought row's latest delta — apply it to the last thought group
 * so the thinking body uses the same clock-anchored reveal as the message body.
 * Earlier thought groups and the post-message state get no reveal.
 */
export function resolveThoughtGroupTokenRevealCss(input: {
	readonly isStreaming?: boolean;
	readonly hasMessageContent: boolean;
	readonly isLastThoughtTextGroup: boolean;
	readonly activeTokenRevealCss?: TokenRevealCss;
}): TokenRevealCss | undefined {
	return shouldStreamAssistantThoughtContent({
		isStreaming: input.isStreaming,
		hasMessageContent: input.hasMessageContent,
		isLastThoughtTextGroup: input.isLastThoughtTextGroup,
	})
		? input.activeTokenRevealCss
		: undefined;
}
