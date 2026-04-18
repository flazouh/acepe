import type { SessionEntry } from "../../../application/dto/session.js";
import type { AssistantMessage } from "../../../types/assistant-message.js";

type ThinkingEntry = {
	type: "thinking";
	id: "thinking-indicator";
	startedAtMs?: number | null;
};

export type MergedAssistantDisplayEntry = {
	type: "assistant_merged";
	key: string;
	memberIds: readonly string[];
	message: AssistantMessage;
	timestamp?: Date;
	latestTimestamp?: Date;
	isStreaming?: boolean;
};

export type VirtualizedDisplayEntry =
	| SessionEntry
	| MergedAssistantDisplayEntry
	| ThinkingEntry;

export const THINKING_DISPLAY_ENTRY: ThinkingEntry = {
	type: "thinking",
	id: "thinking-indicator",
	startedAtMs: null,
};

function isAssistantEntry(entry: SessionEntry): entry is SessionEntry & { type: "assistant" } {
	return entry.type === "assistant";
}

function isVirtualizedAssistantEntry(
	entry: VirtualizedDisplayEntry
): entry is SessionEntry & { type: "assistant" } {
	return entry.type === "assistant";
}

export function isMergedAssistantDisplayEntry(
	entry: VirtualizedDisplayEntry
): entry is MergedAssistantDisplayEntry {
	return entry.type === "assistant_merged";
}

function createMergedAssistantDisplayEntry(
	entry: SessionEntry & { type: "assistant" }
): MergedAssistantDisplayEntry {
	return {
		type: "assistant_merged",
		key: entry.id,
		memberIds: [entry.id],
		message: entry.message,
		timestamp: entry.timestamp,
		latestTimestamp: entry.timestamp,
		isStreaming: entry.isStreaming,
	};
}

function mergeAssistantMessages(
	previous: AssistantMessage,
	next: AssistantMessage
): AssistantMessage {
	return {
		chunks: previous.chunks.concat(next.chunks),
		model: next.model ?? previous.model,
		displayModel: next.displayModel ?? previous.displayModel,
		receivedAt: previous.receivedAt ?? next.receivedAt,
		thinkingDurationMs: next.thinkingDurationMs ?? previous.thinkingDurationMs,
	};
}

function mergeAssistantEntry(
	previous: MergedAssistantDisplayEntry,
	entry: SessionEntry & { type: "assistant" }
): MergedAssistantDisplayEntry {
	return {
		type: "assistant_merged",
		key: previous.key,
		memberIds: previous.memberIds.concat(entry.id),
		message: mergeAssistantMessages(previous.message, entry.message),
		timestamp: previous.timestamp ?? entry.timestamp,
		latestTimestamp: entry.timestamp ?? previous.latestTimestamp,
		isStreaming: previous.isStreaming || entry.isStreaming,
	};
}

function hasThoughtChunks(message: AssistantMessage): boolean {
	return message.chunks.some((chunk) => chunk.type === "thought");
}

export function buildVirtualizedDisplayEntries(
	sessionEntries: readonly SessionEntry[]
): VirtualizedDisplayEntry[] {
	const merged: VirtualizedDisplayEntry[] = [];

	for (const entry of sessionEntries) {
		if (!isAssistantEntry(entry)) {
			merged.push(entry);
			continue;
		}

		const previous = merged.at(-1);
		if (!previous) {
			if (hasThoughtChunks(entry.message)) {
				merged.push(createMergedAssistantDisplayEntry(entry));
				continue;
			}
			merged.push(entry);
			continue;
		}

		if (isMergedAssistantDisplayEntry(previous)) {
			merged[merged.length - 1] = mergeAssistantEntry(previous, entry);
			continue;
		}

		if (isVirtualizedAssistantEntry(previous)) {
			merged[merged.length - 1] = mergeAssistantEntry(
				createMergedAssistantDisplayEntry(previous),
				entry
			);
			continue;
		}

		if (hasThoughtChunks(entry.message)) {
			merged.push(createMergedAssistantDisplayEntry(entry));
			continue;
		}

		merged.push(entry);
	}

	return merged;
}

export function getVirtualizedDisplayEntryKey(entry: VirtualizedDisplayEntry): string {
	if (entry.type === "assistant_merged") return entry.key;
	if (entry.type === "thinking") return entry.id;
	return entry.id;
}

export function getVirtualizedDisplayEntryTimestampMs(
	entry: VirtualizedDisplayEntry
): number | null {
	if (entry.type === "thinking") {
		return entry.startedAtMs ?? null;
	}

	if (entry.type === "assistant_merged") {
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

	if (entry.type !== "assistant_merged" || !hasThoughtChunks(entry.message)) {
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

	const endedAtMs = entry.latestTimestamp?.getTime();
	if (endedAtMs !== undefined && endedAtMs > startedAtMs) {
		return Math.max(0, endedAtMs - startedAtMs);
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
