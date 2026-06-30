import type { ButtonVariant } from "../button/variants.js";
import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";
import { COMPOSER_CHIP_ICON_CLASS } from "./agent-input-chip-classes.js";

/** Shared Selector chrome for reasoning-effort brain triggers in the composer. */
export const REASONING_EFFORT_SELECTOR_VARIANT: ButtonVariant = "ghost";

export const REASONING_EFFORT_SELECTOR_TRIGGER_SIZE: SelectorTriggerSize = "composerChipIcon";

export const REASONING_EFFORT_SELECTOR_SIDE_OFFSET = 8;

/** Matches mic icon footprint in the composer toolbar. */
export const REASONING_EFFORT_BRAIN_ICON_CLASS = COMPOSER_CHIP_ICON_CLASS;
