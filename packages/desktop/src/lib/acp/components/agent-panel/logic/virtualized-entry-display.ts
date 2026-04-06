import type { SessionEntry } from "../../../application/dto/session.js";
import type { AssistantMessage } from "../../../types/assistant-message.js";

type ThinkingEntry = {
	type: "thinking";
	id: "thinking-indicator";
};

export type MergedThoughtAssistantDisplayEntry = {
	type: "assistant_merged_thoughts";
	key: string;
	memberIds: readonly string[];
	message: AssistantMessage;
	timestamp?: Date;
	isStreaming?: boolean;
};

export type VirtualizedDisplayEntry =
	| SessionEntry
	| MergedThoughtAssistantDisplayEntry
	| ThinkingEntry;

export const THINKING_DISPLAY_ENTRY: ThinkingEntry = {
	type: "thinking",
	id: "thinking-indicator",
};

function isThoughtOnlyAssistantEntry(
	entry: SessionEntry
): entry is SessionEntry & { type: "assistant" } {
	if (entry.type !== "assistant") return false;
	const chunks = entry.message.chunks;
	if (chunks.length === 0) return false;
	return chunks.every((chunk) => chunk.type === "thought");
}

export function isMergedThoughtAssistantDisplayEntry(
	entry: VirtualizedDisplayEntry
): entry is MergedThoughtAssistantDisplayEntry {
	return entry.type === "assistant_merged_thoughts";
}

export function buildVirtualizedDisplayEntries(
	sessionEntries: readonly SessionEntry[]
): VirtualizedDisplayEntry[] {
	const merged: VirtualizedDisplayEntry[] = [];

	for (const entry of sessionEntries) {
		if (!isThoughtOnlyAssistantEntry(entry)) {
			merged.push(entry);
			continue;
		}

		const previous = merged.at(-1);
		if (!previous || !isMergedThoughtAssistantDisplayEntry(previous)) {
			merged.push({
				type: "assistant_merged_thoughts",
				key: entry.id,
				memberIds: [entry.id],
				message: entry.message,
				timestamp: entry.timestamp,
				isStreaming: entry.isStreaming,
			});
			continue;
		}

		merged[merged.length - 1] = {
			type: "assistant_merged_thoughts",
			key: previous.key,
			memberIds: [...previous.memberIds, entry.id],
			message: {
				...previous.message,
				...entry.message,
				chunks: [...previous.message.chunks, ...entry.message.chunks],
			},
			timestamp: previous.timestamp ?? entry.timestamp,
			isStreaming: previous.isStreaming || entry.isStreaming,
		};
	}

	return merged;
}

export function getVirtualizedDisplayEntryKey(entry: VirtualizedDisplayEntry): string {
	if (entry.type === "assistant_merged_thoughts") return entry.key;
	if (entry.type === "thinking") return entry.id;
	return entry.id;
}

export function getLatestRevealTargetKey(
	displayEntries: readonly VirtualizedDisplayEntry[]
): string | null {
	for (let i = displayEntries.length - 1; i >= 0; i -= 1) {
		const entry = displayEntries[i];
		if (!entry) {
			continue;
		}
		if (entry.type === "thinking") {
			continue;
		}
		return getVirtualizedDisplayEntryKey(entry);
	}

	const lastEntry = displayEntries.at(-1);
	if (!lastEntry) {
		return null;
	}

	return getVirtualizedDisplayEntryKey(lastEntry);
}

export function shouldObserveRevealResize(
	displayEntries: readonly VirtualizedDisplayEntry[],
	entry: VirtualizedDisplayEntry,
	isStreaming: boolean
): boolean {
	if (!isStreaming) {
		return false;
	}

	return getVirtualizedDisplayEntryKey(entry) === getLatestRevealTargetKey(displayEntries);
}
