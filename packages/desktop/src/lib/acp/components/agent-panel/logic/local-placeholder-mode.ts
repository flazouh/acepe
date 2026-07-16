export type LocalPlaceholderMode = "none" | "connection" | "planning_after_tool";

export type VisibleLocalPlaceholderMode = Exclude<LocalPlaceholderMode, "none">;
