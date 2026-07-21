/**
 * Lazy scene-entry array views for the agent-panel graph materializer's
 * conversation-patch fast paths. Each builder returns a Proxy over a base array
 * that resolves entries on access (patch / append / truncate / splice) and pairs
 * the result with an explicit ScenePatch for downstream index fast paths.
 * Pure structural helpers — no canonical state. GOD-safe.
 */
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import {
	type SceneEntryArrayResult,
	type ScenePatch,
	scenePatchGraphScene,
	scenePatchGraphSceneAppend,
	scenePatchGraphSceneSplice,
	scenePatchGraphSceneTruncation,
} from "../components/agent-panel/logic/scene-patch.js";
import type { CachedConversationState } from "./conversation-cache-types.js";

export type { SceneEntryArrayResult } from "../components/agent-panel/logic/scene-patch.js";

export function conversationFromSceneEntryArrayResult(
	result: SceneEntryArrayResult,
	isStreaming: boolean
): CachedConversationState["conversation"] {
	return {
		entries: result.entries,
		scenePatch: result.scenePatch,
		isStreaming,
	};
}

export function conversationWithScenePatch(
	entries: readonly AgentPanelSceneEntryModel[],
	isStreaming: boolean,
	scenePatch: ScenePatch
): CachedConversationState["conversation"] {
	return {
		entries,
		isStreaming,
		scenePatch,
	};
}

export function addSceneEntryPatch(
	patches: Map<number, AgentPanelSceneEntryModel> | null,
	rowIndex: number,
	entry: AgentPanelSceneEntryModel
): Map<number, AgentPanelSceneEntryModel> {
	const nextPatches = patches ?? new Map<number, AgentPanelSceneEntryModel>();
	nextPatches.set(rowIndex, entry);
	return nextPatches;
}

export function createPatchedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	entryPatches: ReadonlyMap<number, AgentPanelSceneEntryModel>
): SceneEntryArrayResult {
	const target = new Array<AgentPanelSceneEntryModel>(baseEntries.length);
	const entries = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < baseEntries.length; index += 1) {
						yield entryPatches.get(index) ?? baseEntries[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return entryPatches.get(index) ?? baseEntries[index];
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
				return index >= 0 && index < baseEntries.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < baseEntries.length) {
				return {
					configurable: true,
					enumerable: true,
					value: entryPatches.get(index) ?? baseEntries[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
	return {
		entries,
		scenePatch: scenePatchGraphScene({
			baseSceneEntries: baseEntries,
			entries: Array.from(entryPatches.values()),
			entriesByIndex: entryPatches,
		}),
	};
}

export function createAppendedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	appendedEntries: readonly AgentPanelSceneEntryModel[]
): SceneEntryArrayResult {
	const entries = createSceneEntryArrayView(baseEntries.length + appendedEntries.length, (index) =>
		index < baseEntries.length ? baseEntries[index] : appendedEntries[index - baseEntries.length]
	);
	return {
		entries,
		scenePatch: scenePatchGraphSceneAppend({
			baseSceneEntries: baseEntries,
			appendedEntries,
		}),
	};
}

export function createTruncatedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	length: number
): SceneEntryArrayResult {
	const entries = createSceneEntryArrayView(length, (index) => baseEntries[index]);
	return {
		entries,
		scenePatch: scenePatchGraphSceneTruncation({
			baseSceneEntries: baseEntries,
			length,
		}),
	};
}

export function createInsertedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	insertIndex: number,
	insertedEntries: readonly AgentPanelSceneEntryModel[],
	trailingEntries: readonly AgentPanelSceneEntryModel[]
): SceneEntryArrayResult {
	const entries = createSceneEntryArrayView(
		insertIndex + insertedEntries.length + trailingEntries.length,
		(index) => {
			if (index < insertIndex) {
				return baseEntries[index];
			}
			const insertedIndex = index - insertIndex;
			if (insertedIndex < insertedEntries.length) {
				return insertedEntries[insertedIndex];
			}
			return trailingEntries[insertedIndex - insertedEntries.length];
		}
	);
	return {
		entries,
		scenePatch: scenePatchGraphSceneSplice({
			baseSceneEntries: baseEntries,
			startIndex: insertIndex,
			insertedEntries,
			trailingEntries,
		}),
	};
}

export function createSceneEntryArrayView(
	length: number,
	selectEntry: (index: number) => AgentPanelSceneEntryModel | undefined
): readonly AgentPanelSceneEntryModel[] {
	const target = new Array<AgentPanelSceneEntryModel>(length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectEntry(index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectEntry(index);
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
				return {
					configurable: true,
					enumerable: true,
					value: selectEntry(index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
}

export function createArrayLikeOwnKeys(length: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < length; index += 1) {
		keys.push(String(index));
	}
	keys.push("length");
	return keys;
}

export function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}
