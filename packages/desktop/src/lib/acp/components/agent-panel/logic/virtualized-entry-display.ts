// Compatibility re-export barrel — implementation lives in scene-display-rows.ts.
export {
	appendSceneDisplayRows as appendVirtualizedDisplayEntriesFromScene,
	appendSceneDisplayRowsFromIndex as appendVirtualizedDisplayEntriesFromSceneRange,
	buildSceneDisplayRows as buildVirtualizedDisplayEntries,
	buildSceneDisplayRowsFromScene as buildVirtualizedDisplayEntriesFromScene,
	findLastAssistantSceneIndex,
	getLatestSceneDisplayRevealTargetKey as getLatestRevealTargetKey,
	getSceneDisplayRowKey as getVirtualizedDisplayEntryKey,
	getSceneDisplayRowTimestampMs as getVirtualizedDisplayEntryTimestampMs,
	isMergedAssistantDisplayEntry,
	type MergedAssistantDisplayEntry,
	resolveSceneDisplayRowThinkingDurationMs as resolveDisplayEntryThinkingDurationMs,
	type SceneDisplayRow,
	type SceneDisplayRow as VirtualizedDisplayEntry,
	shouldObserveSceneDisplayRowRevealResize as shouldObserveRevealResize,
	THINKING_DISPLAY_ENTRY,
} from "./scene-display-rows.js";
