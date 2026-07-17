import type { ChunkGroup } from "../../lib/assistant-message/assistant-chunk-grouper.js";

/**
 * All message groups are currently rendered as visible (the token-reveal
 * truncation-by-revealed-char-count behavior was removed 2026-07-17). Kept as
 * a named seam — rather than inlining `.slice()` at the call site — so a
 * future streaming-presentation feature has an obvious place to reintroduce
 * partial visibility.
 */
export function resolveVisibleAssistantMessageGroups(input: {
	readonly messageGroups: readonly ChunkGroup[];
}): ChunkGroup[] {
	return input.messageGroups.slice();
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
