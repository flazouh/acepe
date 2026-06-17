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
	resolveSceneDisplayRowThinkingDurationMs as resolveDisplayEntryThinkingDurationMs,
	shouldObserveSceneDisplayRowRevealResize as shouldObserveRevealResize,
	THINKING_DISPLAY_ENTRY,
	type MergedAssistantDisplayEntry,
	type SceneDisplayRow,
	type SceneDisplayRow as VirtualizedDisplayEntry,
} from "./scene-display-rows.js";
