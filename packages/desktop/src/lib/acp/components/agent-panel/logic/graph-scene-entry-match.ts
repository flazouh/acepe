import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import type { VirtualizedDisplayEntry } from "./virtualized-entry-display.js";
import { getVirtualizedDisplayEntryKey } from "./virtualized-entry-display.js";

export function findGraphSceneEntryForDisplayEntry(
	entry: VirtualizedDisplayEntry | undefined,
	sceneEntriesById: ReadonlyMap<string, AgentPanelSceneEntryModel> | undefined
): AgentPanelSceneEntryModel | undefined {
	if (
		entry === undefined ||
		entry.type === "thinking" ||
		entry.type === "assistant_merged" ||
		sceneEntriesById === undefined
	) {
		return undefined;
	}

	return sceneEntriesById.get(getVirtualizedDisplayEntryKey(entry));
}

export function createGraphSceneEntryIndex(
	sceneEntries: readonly AgentPanelSceneEntryModel[] | undefined
): ReadonlyMap<string, AgentPanelSceneEntryModel> | undefined {
	if (sceneEntries === undefined) {
		return undefined;
	}

	const entriesById = new Map<string, AgentPanelSceneEntryModel>();
	for (const sceneEntry of sceneEntries) {
		if (!entriesById.has(sceneEntry.id)) {
			entriesById.set(sceneEntry.id, sceneEntry);
		}
	}
	return entriesById;
}
