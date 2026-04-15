import type { SessionEntry } from "../../../application/dto/session.js";
import type { AssistantMessage } from "../../../types/assistant-message.js";

type ThinkingEntry = {
	type: "thinking";
	id: "thinking-indicator";
	startedAtMs?: number | null;
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
	startedAtMs: null,
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

export function getVirtualizedDisplayEntryTimestampMs(
	entry: VirtualizedDisplayEntry
): number | null {
	if (entry.type === "thinking") {
		return entry.startedAtMs ?? null;
	}

	if (entry.type === "assistant_merged_thoughts") {
		return entry.timestamp?.getTime() ?? null;
	}

	return entry.timestamp?.getTime() ?? null;
}

export function resolveDisplayEntryThinkingDurationMs(
	displayEntries: readonly VirtualizedDisplayEntry[],
	index: number,
	nowMs: number = Date.now()
): number | null {
	const entry = displayEntries[index];
	if (!entry) {
		return null;
	}

	if (entry.type === "thinking") {
		if (entry.startedAtMs === null || entry.startedAtMs === undefined) {
			return null;
		}

		return Math.max(0, nowMs - entry.startedAtMs);
	}

	if (entry.type !== "assistant_merged_thoughts") {
		return null;
	}

	const startedAtMs = entry.timestamp?.getTime();
	if (startedAtMs === undefined) {
		return null;
	}

	for (let offset = index + 1; offset < displayEntries.length; offset += 1) {
		const nextEntry = displayEntries[offset];
		if (!nextEntry) {
			continue;
		}

		if (nextEntry.type === "thinking") {
			return Math.max(0, nowMs - startedAtMs);
		}

		const nextTimestampMs = getVirtualizedDisplayEntryTimestampMs(nextEntry);
		if (nextTimestampMs !== null) {
			return Math.max(0, nextTimestampMs - startedAtMs);
		}
	}

	if (entry.isStreaming) {
		return Math.max(0, nowMs - startedAtMs);
	}

	return null;
}

export function getLatestRevealTargetKey(
	displayEntries: readonly VirtualizedDisplayEntry[]
): string | null {
	const lastEntry = displayEntries.at(-1);
	if (!lastEntry) {
		return null;
	}

	return getVirtualizedDisplayEntryKey(lastEntry);
}

function getLatestStreamingResizeTargetKey(
	displayEntries: readonly VirtualizedDisplayEntry[]
): string | null {
	for (let i = displayEntries.length - 1; i >= 0; i -= 1) {
		const entry = displayEntries[i];
		if (!entry || entry.type === "thinking") {
			continue;
		}
		return getVirtualizedDisplayEntryKey(entry);
	}

	return null;
}

export function shouldObserveRevealResize(
	displayEntries: readonly VirtualizedDisplayEntry[],
	entry: VirtualizedDisplayEntry,
	isStreaming: boolean
): boolean {
	void isStreaming;
	return getVirtualizedDisplayEntryKey(entry) === getLatestStreamingResizeTargetKey(displayEntries);
}
