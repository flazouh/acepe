export type LocalPlaceholderMode = "none" | "connection" | "planning";

export type VisibleLocalPlaceholderMode = Exclude<LocalPlaceholderMode, "none">;
