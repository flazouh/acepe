import type { ButtonVariant } from "../button/variants.js";
import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";
import { FUSED_CONTROL_COMPOSER_ICON_SIZE_CLASS } from "../panel-header/project-card-action-button-class.js";

/** Shared Selector chrome for reasoning-effort brain triggers in the composer. */
export const REASONING_EFFORT_SELECTOR_VARIANT: ButtonVariant = "ghost";

export const REASONING_EFFORT_SELECTOR_TRIGGER_SIZE: SelectorTriggerSize = "composerChipIcon";

export const REASONING_EFFORT_SELECTOR_SIDE_OFFSET = 8;

/** Matches mic icon footprint in {@link FUSED_CONTROL_COMPOSER_ICON_SIZE_CLASS}. */
export const REASONING_EFFORT_BRAIN_ICON_CLASS = FUSED_CONTROL_COMPOSER_ICON_SIZE_CLASS;
