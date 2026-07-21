/** Presentational sectioned feed shell — used by website demos; desktop no longer mounts it. */
export { default as SectionedFeed } from "./attention-queue.svelte";
export { default as FeedItem } from "./attention-queue-item.svelte";
export { default as FeedSectionHeader } from "./feed-section-header.svelte";
export { default as ActivityEntry } from "./attention-queue-entry.svelte";
export { default as AttentionQueueQuestionCard } from "./attention-queue-question-card.svelte";
export { default as PermissionFeedItem } from "./permission-feed-item.svelte";
export { sectionColor, sectionAccentColor } from "./section-color.js";

export type {
  SectionedFeedSectionId,
  SectionedFeedGroup,
  SectionedFeedItemData,
  ActivityEntryMode,
  ActivityEntryToolDisplay,
  ActivityEntryTodoProgress,
  ActivityEntryQuestion,
  ActivityEntryQuestionOption,
  ActivityEntryQuestionProgress,
} from "./types.js";
