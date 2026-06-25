/** Matches session-list project card hover action buttons. */
export const PROJECT_CARD_ACTION_BUTTON_CLASS =
	"flex size-5 shrink-0 items-center justify-center rounded-md border-0 p-0 leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:block [&_svg]:shrink-0";

/** Shared three-dot overflow glyph size (voice model menu, setup chips, panel headers). */
export const OVERFLOW_DOTS_ICON_CLASS = "h-3 w-3 shrink-0";

/** Fused control chip groups (setup bar worktree, voice mic+menu, etc.). */
export const FUSED_CONTROL_CHIP_GROUP_CLASS = "overflow-hidden rounded-md bg-accent/30";

/** Leading segment (left) inside {@link FUSED_CONTROL_CHIP_GROUP_CLASS} — e.g. voice recording timer. */
export const FUSED_CONTROL_LEADING_SEGMENT_CLASS =
	"flex shrink-0 items-center justify-center rounded-none rounded-l-md border-0 border-r border-border/30 bg-transparent px-1.5 py-1 leading-none text-muted-foreground";

/** Primary segment (left) inside {@link FUSED_CONTROL_CHIP_GROUP_CLASS}. */
export const FUSED_CONTROL_PRIMARY_BUTTON_CLASS =
	"flex shrink-0 items-center justify-center rounded-none rounded-l-md border-0 bg-transparent px-1 py-1 leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 [&_svg]:block [&_svg]:shrink-0";

/** Overflow segment (right) with three-dot menu — no horizontal padding; right corners match fused shell (`rounded-md`). */
export const FUSED_CONTROL_OVERFLOW_BUTTON_CLASS =
	"flex shrink-0 items-center justify-center rounded-none rounded-r-md border-0 border-l border-border/30 bg-transparent p-0 py-1 leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 [&_svg]:block [&_svg]:shrink-0";

/** @deprecated Use {@link FUSED_CONTROL_OVERFLOW_BUTTON_CLASS} */
export const SETUP_CHIP_OVERFLOW_BUTTON_CLASS = FUSED_CONTROL_OVERFLOW_BUTTON_CLASS;
