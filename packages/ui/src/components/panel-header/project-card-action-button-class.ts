import {
	COMPOSER_CHIP_ICON_CLASS,
	COMPOSER_CHIP_ICON_SIZE_PX,
	SETUP_CHIP_ICON_CLASS,
	SETUP_CHIP_ICON_SIZE_PX,
	SETUP_CHIP_LABEL_TEXT_CLASS,
} from "../agent-panel/agent-input-chip-classes.js";

export {
	COMPOSER_CHIP_ICON_CLASS,
	COMPOSER_CHIP_ICON_SIZE_PX,
	COMPOSER_CHIP_LABEL_TEXT_CLASS,
	SETUP_CHIP_ICON_CLASS,
	SETUP_CHIP_ICON_SIZE_PX,
	SETUP_CHIP_LABEL_TEXT_CLASS,
} from "../agent-panel/agent-input-chip-classes.js";

/** Matches session-list project card hover action buttons. */
export const PROJECT_CARD_ACTION_BUTTON_CLASS =
	"flex size-5 shrink-0 items-center justify-center rounded-md border-0 p-0 leading-none text-muted-foreground/35 transition-colors hover:bg-accent hover:text-foreground focus-visible:text-foreground [&_svg]:block [&_svg]:shrink-0 [&_svg]:text-muted-foreground/35 [&_svg]:transition-colors hover:[&_svg]:text-foreground focus-visible:[&_svg]:text-foreground";

/** Shared three-dot overflow glyph size (voice model menu, setup chips, panel headers). */
export const OVERFLOW_DOTS_ICON_CLASS = "size-[14px] shrink-0";

/** @deprecated Use {@link SETUP_CHIP_LABEL_TEXT_CLASS} */
export const FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS = SETUP_CHIP_LABEL_TEXT_CLASS;

/** @deprecated Use {@link SETUP_CHIP_ICON_SIZE_PX} */
export const FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX = SETUP_CHIP_ICON_SIZE_PX;

/** @deprecated Use {@link SETUP_CHIP_ICON_CLASS} */
export const FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS = SETUP_CHIP_ICON_CLASS;

/** @deprecated Use {@link COMPOSER_CHIP_ICON_SIZE_PX} */
export const FUSED_CONTROL_COMPOSER_ICON_SIZE_PX = COMPOSER_CHIP_ICON_SIZE_PX;

/** @deprecated Use {@link COMPOSER_CHIP_ICON_CLASS} */
export const FUSED_CONTROL_COMPOSER_ICON_SIZE_CLASS = COMPOSER_CHIP_ICON_CLASS;
