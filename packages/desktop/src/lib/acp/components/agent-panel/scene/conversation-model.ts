import type {
	AgentPanelSceneEntryModel,
	AgentPanelSessionStatus,
} from "@acepe/ui/agent-panel/types";
import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { SessionStatus } from "../../../application/dto/session-status.js";
import type { TurnState } from "../../../store/types.js";
import type { SceneDisplayRow } from "../logic/scene-display-rows.js";
import { contentBlocksToText, extractAssistantMarkdown } from "./assistant-content.js";
import { mapToolCallToSceneEntry } from "./tool/tool-call-entry.js";

export function mapSessionStatusToSceneStatus(
	status: SessionStatus | null | undefined,
	entryCount: number
): AgentPanelSessionStatus {
	if (!status) {
		return "empty";
	}

	switch (status) {
		case "connecting":
			return "warming";
		case "idle":
			return entryCount > 0 ? "idle" : "empty";
		case "ready":
			return "connected";
		case "streaming":
			return "running";
		case "error":
			return "error";
		default:
			return "empty";
	}
}

export function mapSessionEntriesToConversationModel(
	entries: readonly SessionEntry[],
	turnState: TurnState | undefined
): { entries: readonly AgentPanelSceneEntryModel[]; isStreaming: boolean } {
	return {
		entries: createMappedConversationEntriesView(entries, turnState),
		isStreaming: turnState === "streaming",
	};
}

function createMappedConversationEntriesView(
	entries: readonly SessionEntry[],
	turnState: TurnState | undefined
): readonly AgentPanelSceneEntryModel[] {
	const target = new Array<AgentPanelSceneEntryModel>(entries.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						const entry = entries[index];
						if (entry !== undefined) {
							yield mapSessionEntryToConversationEntry(entry, turnState);
						}
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					const entry = entries[index];
					return entry === undefined
						? undefined
						: mapSessionEntryToConversationEntry(entry, turnState);
				}
				if (property === "slice") {
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				const entry = entries[index];
				return {
					configurable: true,
					enumerable: true,
					value:
						entry === undefined ? undefined : mapSessionEntryToConversationEntry(entry, turnState),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			const keys: string[] = [];
			for (let index = 0; index < targetArray.length; index += 1) {
				keys.push(String(index));
			}
			keys.push("length");
			return keys;
		},
	});
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

export function mapSessionEntryToConversationEntry(
	entry: SessionEntry,
	turnState: TurnState | undefined,
	options?: { isOptimistic?: boolean }
): AgentPanelSceneEntryModel {
	if (entry.type === "user") {
		return {
			id: entry.id,
			type: "user",
			text: contentBlocksToText(entry.message.chunks),
			isOptimistic: options?.isOptimistic === true ? true : undefined,
			timestampMs: entry.timestamp?.getTime(),
		};
	}

	if (entry.type === "assistant") {
		return {
			id: entry.id,
			type: "assistant",
			markdown: extractAssistantMarkdown(entry),
			isStreaming: entry.isStreaming,
			timestampMs: entry.timestamp?.getTime(),
		};
	}

	if (entry.type === "tool_call") {
		return mapToolCallToSceneEntry(entry.message, turnState, false, {
			displayEntryId: entry.id,
		});
	}

	if (entry.type === "ask") {
		return {
			id: entry.id,
			type: "tool_call",
			kind: "other",
			title: "Question",
			subtitle: entry.message.question,
			status: "running",
			question: {
				question: entry.message.question,
				header: entry.message.description ?? null,
				options: entry.message.options.map((option) => {
					return {
						label: option.label,
						description: option.description ?? null,
					};
				}),
				multiSelect: false,
			},
		};
	}

	return assertUnreachableSessionEntry(entry);
}

function assertUnreachableSessionEntry(entry: never): never {
	throw new Error(`Unsupported session entry type: ${JSON.stringify(entry)}`);
}

export function mapVirtualizedDisplayEntryToConversationEntry(
	entry: SceneDisplayRow,
	turnState: TurnState | undefined,
	isStreamingAssistant: boolean,
	nowMs: number = Date.now()
): AgentPanelSceneEntryModel {
	if (entry.type === "thinking") {
		const thinkingEntry: AgentPanelSceneEntryModel = {
			id: entry.id,
			type: "thinking",
			durationMs:
				entry.startedAtMs === null || entry.startedAtMs === undefined
					? null
					: Math.max(0, nowMs - entry.startedAtMs),
			startedAtMs: entry.startedAtMs,
		};
		if (entry.label !== null && entry.label !== undefined) {
			return {
				id: thinkingEntry.id,
				type: thinkingEntry.type,
				durationMs: thinkingEntry.durationMs,
				startedAtMs: thinkingEntry.startedAtMs,
				label: entry.label,
			};
		}
		return thinkingEntry;
	}

	if (entry.type === "assistant_merged") {
		return {
			id: entry.key,
			type: "assistant",
			markdown: entry.markdown,
			message: {
				chunks: entry.message.chunks,
				model: entry.message.model,
				displayModel: entry.message.displayModel,
				receivedAt: entry.message.receivedAt,
				thinkingDurationMs: entry.message.thinkingDurationMs,
			},
			isStreaming: isStreamingAssistant || entry.isStreaming,
			timestampMs: entry.timestamp?.getTime(),
		};
	}

	if (entry.type === "missing") {
		return {
			id: entry.id,
			type: "missing",
		};
	}

	const mapped = mapSessionEntryToConversationEntry(entry, turnState);
	if (mapped.type === "assistant") {
		return {
			id: mapped.id,
			type: mapped.type,
			markdown: mapped.markdown,
			isStreaming: isStreamingAssistant,
			timestampMs: mapped.timestampMs,
		};
	}

	return mapped;
}
