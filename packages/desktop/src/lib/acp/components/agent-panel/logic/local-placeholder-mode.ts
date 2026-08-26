// #268 defect 3: "waiting_for_approval" is a turn blocked on an unanswered
// approval (canonical activity.kind === "waiting_for_user") -- distinct from
// "planning" (an endless spark, no label) so the composer area can say WHY
// the turn is stalled instead of spinning forever with no explanation.
export type LocalPlaceholderMode = "none" | "connection" | "planning" | "waiting_for_approval";

export type VisibleLocalPlaceholderMode = Exclude<LocalPlaceholderMode, "none">;
