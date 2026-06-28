import { cn } from "../../lib/utils.js";

/** Matches session-list project card hover action buttons. */
export const PROJECT_CARD_ACTION_BUTTON_CLASS =
	"flex size-5 shrink-0 items-center justify-center rounded-md border-0 p-0 leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:block [&_svg]:shrink-0";

/** Shared three-dot overflow glyph size (voice model menu, setup chips, panel headers). */
export const OVERFLOW_DOTS_ICON_CLASS = "size-[14px] shrink-0";

/** Shared surface for fused setup chips (group shells and standalone triggers). */
export const FUSED_CONTROL_CHIP_SURFACE_CLASS = "rounded-md bg-accent/30";

/** Shared label typography for setup bar chips (project, agent, branch, worktree). */
export const FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS = "text-xs leading-none font-normal";

/** Icon footprint for new-thread setup bar chips (project, agent, branch, worktree). */
export const FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX = 14;
export const FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS = `size-[${FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX}px] shrink-0`;

/** Icon footprint for composer trailing toolbar chips (model, reasoning, mic). */
export const FUSED_CONTROL_COMPOSER_ICON_SIZE_PX = 15;
export const FUSED_CONTROL_COMPOSER_ICON_SIZE_CLASS = `size-[${FUSED_CONTROL_COMPOSER_ICON_SIZE_PX}px] shrink-0`;

type FusedChipIconSizePx =
	| typeof FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX
	| typeof FUSED_CONTROL_COMPOSER_ICON_SIZE_PX;

const FUSED_CONTROL_GROUPED_CHIP_SEGMENT_CLASS = "!rounded-none !bg-transparent shadow-none";

function fusedChipSvgSizeClass(iconSizePx: FusedChipIconSizePx): string {
	return `[&_svg]:block [&_svg]:size-[${iconSizePx}px] [&_svg]:shrink-0`;
}

function fusedLabeledChipButtonClass(iconSizePx: FusedChipIconSizePx): string {
	return cn(
		FUSED_CONTROL_CHIP_SURFACE_CLASS,
		"flex shrink-0 items-center justify-center gap-1 border-0 px-1.5 py-1 leading-none text-xs font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
		fusedChipSvgSizeClass(iconSizePx)
	);
}

function fusedIconChipButtonClass(iconSizePx: FusedChipIconSizePx): string {
	return cn(
		FUSED_CONTROL_CHIP_SURFACE_CLASS,
		"flex shrink-0 items-center justify-center gap-1 border-0 px-1 py-1 leading-none text-xs font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
		fusedChipSvgSizeClass(iconSizePx)
	);
}

function fusedGroupedLabeledChipButtonClass(iconSizePx: FusedChipIconSizePx): string {
	return cn(fusedLabeledChipButtonClass(iconSizePx), FUSED_CONTROL_GROUPED_CHIP_SEGMENT_CLASS);
}

/** Icon chip in the composer trailing toolbar (reasoning, mic segment). */
export const FUSED_CONTROL_COMPOSER_CHIP_BUTTON_CLASS = fusedIconChipButtonClass(
	FUSED_CONTROL_COMPOSER_ICON_SIZE_PX
);

/** Standalone composer icon chip (reasoning) — same px/py + icon footprint as mic primary segment. */
export const FUSED_CONTROL_COMPOSER_STANDALONE_ICON_CHIP_CLASS =
	FUSED_CONTROL_COMPOSER_CHIP_BUTTON_CLASS;

/** Labeled composer chip (model selector, config options). */
export const FUSED_CONTROL_COMPOSER_CHIP_LABEL_BUTTON_CLASS = fusedLabeledChipButtonClass(
	FUSED_CONTROL_COMPOSER_ICON_SIZE_PX
);

/** Labeled setup bar chip (project, agent, branch). */
export const FUSED_CONTROL_SETUP_CHIP_BUTTON_CLASS = cn(
	fusedLabeledChipButtonClass(FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX),
	"!bg-accent/30"
);

/** Icon-only setup bar chip (compact controls). */
export const FUSED_CONTROL_SETUP_ICON_CHIP_BUTTON_CLASS = cn(
	fusedIconChipButtonClass(FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX),
	"!bg-accent/30"
);

/** Leading icon segment inside a fused setup bar button group. */
export const FUSED_CONTROL_SETUP_GROUPED_ICON_CHIP_BUTTON_CLASS = cn(
	FUSED_CONTROL_SETUP_ICON_CHIP_BUTTON_CLASS,
	FUSED_CONTROL_GROUPED_CHIP_SEGMENT_CLASS
);

/** Fused control chip groups (setup bar worktree, voice mic+menu, etc.). */
export const FUSED_CONTROL_CHIP_GROUP_CLASS = `overflow-hidden ${FUSED_CONTROL_CHIP_SURFACE_CLASS}`;

/** Leading segment (left) inside {@link FUSED_CONTROL_CHIP_GROUP_CLASS} — e.g. voice recording timer. */
export const FUSED_CONTROL_LEADING_SEGMENT_CLASS =
	"flex shrink-0 items-center justify-center rounded-none rounded-l-md border-0 border-r border-border/30 bg-transparent px-1.5 py-1 leading-none text-muted-foreground";

/** Primary segment inside {@link FUSED_CONTROL_CHIP_GROUP_CLASS}. */
export const FUSED_CONTROL_PRIMARY_BUTTON_CLASS = cn(
	"flex shrink-0 items-center justify-center rounded-none rounded-l-md border-0 bg-transparent px-1 py-1 leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50",
	fusedChipSvgSizeClass(FUSED_CONTROL_COMPOSER_ICON_SIZE_PX)
);

/** Middle segment inside a multi-item {@link FUSED_CONTROL_CHIP_GROUP_CLASS}. */
export const FUSED_CONTROL_GROUPED_MIDDLE_BUTTON_CLASS = cn(
	"flex shrink-0 items-center justify-center rounded-none border-0 border-l border-border/30 bg-transparent px-1 py-1 leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50",
	fusedChipSvgSizeClass(FUSED_CONTROL_COMPOSER_ICON_SIZE_PX)
);

/** First labeled segment inside a fused composer button group. */
export const FUSED_CONTROL_GROUPED_CHIP_LABEL_BUTTON_CLASS = fusedGroupedLabeledChipButtonClass(
	FUSED_CONTROL_COMPOSER_ICON_SIZE_PX
);

/** First labeled segment inside a fused setup bar button group (worktree). */
export const FUSED_CONTROL_SETUP_GROUPED_CHIP_LABEL_BUTTON_CLASS = fusedGroupedLabeledChipButtonClass(
	FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX
);

/** Overflow segment (right) with three-dot menu — no horizontal padding; right corners match fused shell (`rounded-md`). */
export const FUSED_CONTROL_OVERFLOW_BUTTON_CLASS =
	"flex shrink-0 items-center justify-center rounded-none rounded-r-md border-0 border-l border-border/30 bg-transparent p-0 py-1 leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 [&_svg]:block [&_svg]:shrink-0";

/** Trailing icon segment inside a fused setup bar button group. */
export const FUSED_CONTROL_SETUP_GROUPED_ICON_TRAILING_BUTTON_CLASS = cn(
	FUSED_CONTROL_SETUP_GROUPED_ICON_CHIP_BUTTON_CLASS,
	"rounded-none rounded-r-md border-l border-border/30"
);

/** @deprecated Prefer {@link FUSED_CONTROL_SETUP_GROUPED_ICON_TRAILING_BUTTON_CLASS} for icon segments. */
export const FUSED_CONTROL_SETUP_GROUPED_ICON_OVERFLOW_BUTTON_CLASS = cn(
	FUSED_CONTROL_OVERFLOW_BUTTON_CLASS,
	fusedChipSvgSizeClass(FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX)
);

/** @deprecated Use {@link FUSED_CONTROL_OVERFLOW_BUTTON_CLASS} */
export const SETUP_CHIP_OVERFLOW_BUTTON_CLASS = FUSED_CONTROL_OVERFLOW_BUTTON_CLASS;
