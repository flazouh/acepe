import type {
	AgentAssistantEntry,
	AgentPanelSceneEntryModel,
} from "@acepe/ui/agent-panel";
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

type MissingDisplayEntry = {
	type: "missing";
	id: string;
};

export type VirtualizedDisplayEntry =
	| SessionEntry
	| MergedAssistantDisplayEntry
	| ThinkingEntry
	| MissingDisplayEntry;

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

// ===== SCENE-NATIVE MERGING =====

function createMergedAssistantDisplayEntryFromScene(
	entry: AgentAssistantEntry
): MergedAssistantDisplayEntry {
	const ts = entry.timestampMs !== undefined ? new Date(entry.timestampMs) : undefined;
	return {
		type: "assistant_merged",
		key: entry.id,
		memberIds: [entry.id],
		message: {
			chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
		},
		timestamp: ts,
		latestTimestamp: ts,
		isStreaming: entry.isStreaming,
	};
}

function mergeSceneAssistantEntry(
	previous: MergedAssistantDisplayEntry,
	entry: AgentAssistantEntry
): MergedAssistantDisplayEntry {
	return {
		type: "assistant_merged",
		key: previous.key,
		memberIds: previous.memberIds.concat(entry.id),
		message: mergeAssistantMessages(previous.message, {
			chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
		}),
		timestamp: previous.timestamp,
		latestTimestamp:
			entry.timestampMs !== undefined ? new Date(entry.timestampMs) : previous.latestTimestamp,
		isStreaming: previous.isStreaming || entry.isStreaming,
	};
}

/**
 * Builds virtualized display entries from scene-model entries.
 *
 * Produces the same `VirtualizedDisplayEntry[]` shape as `buildVirtualizedDisplayEntries`,
 * so `VList` keying and the streaming-indicator state machine are unchanged.
 * Consecutive assistant entries are merged into a single `MergedAssistantDisplayEntry`.
 * User and tool entries pass through as synthetic `SessionEntry`-compatible objects
 * (content sourced from scene fields; the actual render is either the legacy desktop
 * `UserMessage`/`AssistantMessage` component or `AgentPanelConversationEntry` for tools).
 */
export function buildVirtualizedDisplayEntriesFromScene(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): VirtualizedDisplayEntry[] {
	const merged: VirtualizedDisplayEntry[] = [];

	for (const entry of sceneEntries) {
		if (entry.type === "assistant") {
			const previous = merged.at(-1);
			if (previous !== undefined && isMergedAssistantDisplayEntry(previous)) {
				merged[merged.length - 1] = mergeSceneAssistantEntry(previous, entry);
				continue;
			}
			merged.push(createMergedAssistantDisplayEntryFromScene(entry));
			continue;
		}

		if (entry.type === "user") {
			const syntheticUser = {
				id: entry.id,
				type: "user" as const,
				timestamp: entry.timestampMs !== undefined ? new Date(entry.timestampMs) : undefined,
				message: {
					content: { type: "text" as const, text: entry.text },
					chunks: [],
				},
			} satisfies SessionEntry;
			merged.push(syntheticUser);
			continue;
		}

		if (entry.type === "tool_call") {
			// Synthetic stub — content never accessed in the scene render path because
			// tool entries are always found in the scene index and rendered via
			// AgentPanelConversationEntry, not getToolCallMessage.
			const syntheticTool = {
				id: entry.id,
				type: "tool_call" as const,
				message: {
					id: entry.id,
					name: entry.title,
					arguments: { kind: "execute" as const },
					status: "pending" as const,
					awaitingPlanApproval: false,
				},
			} satisfies SessionEntry;
			merged.push(syntheticTool);
			continue;
		}

		if (entry.type === "thinking") {
			merged.push({
				type: THINKING_DISPLAY_ENTRY.type,
				id: THINKING_DISPLAY_ENTRY.id,
				startedAtMs: entry.startedAtMs,
			});
			continue;
		}

		if (entry.type === "missing") {
			merged.push({
				id: entry.id,
				type: "missing",
			});
		}
	}

	return merged;
}

/**
 * Returns the index of the last assistant entry in a scene entries array, or -1 if none.
 * Scene-native equivalent of the legacy `findLastAssistantIndex(SessionEntry[])` helper.
 */
export function findLastAssistantSceneIndex(
	entries: readonly AgentPanelSceneEntryModel[]
): number {
	return entries.findLastIndex((e) => e.type === "assistant");
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

	if (entry.type === "missing") {
		return null;
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
