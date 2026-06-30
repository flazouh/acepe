/** Label typography for setup bar chips — matches `Button` size `sm` text scale. */
export const SETUP_CHIP_LABEL_TEXT_CLASS = "text-xs leading-none font-normal";

/** Icon footprint for setup bar chips (project, agent, branch, worktree). */
export const SETUP_CHIP_ICON_SIZE_PX = 14;
export const SETUP_CHIP_ICON_CLASS = "size-[14px] shrink-0";

/** Label typography for composer toolbar chips — same scale as setup bar. */
export const COMPOSER_CHIP_LABEL_TEXT_CLASS = SETUP_CHIP_LABEL_TEXT_CLASS;

/** Icon footprint for composer trailing toolbar chips (model, reasoning, mic). */
export const COMPOSER_CHIP_ICON_SIZE_PX = 15;
export const COMPOSER_CHIP_ICON_CLASS = "size-[15px] shrink-0";

/** Leading non-interactive segment inside fused composer button groups. */
export const COMPOSER_FUSED_GROUP_LEADING_SEGMENT_CLASS =
	"flex h-7 shrink-0 items-center justify-center rounded-none rounded-l-md border-0 border-r border-border/30 bg-secondary px-1.5 text-xs leading-none text-muted-foreground";
