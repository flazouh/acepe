import Root from "./button.svelte";

import type { ButtonProps } from "./variants.js";

export {
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type ControlTokenVariant,
  type ControlTokenSize,
  buttonVariants,
  buttonVariantShowcaseOrder,
  buttonSizeShowcaseOrder,
  buttonBaseClass,
  buttonShadcnVariantAppearanceClass,
  buttonShadcnSizeAppearanceClass,
  getButtonVariantAppearanceClass,
  getButtonSizeAppearanceClass,
  BUTTON_CHIP_CHILD_ICON_SELECTOR,
  BUTTON_CHIP_ICON_SIZE_PX,
} from "./variants.js";

export { getButtonClass, getDialogHeaderIconCloseClass, type HeaderIconCloseSize } from "./button-class.js";

export {
  controlTokensShowcaseMeta,
  buttonSizeShowcaseColumnMinWidth,
  getButtonShowcaseDisplay,
} from "./control-tokens-showcase-meta.js";

export { default as ControlTokensShowcase } from "./control-tokens-showcase.svelte";

export type Props = ButtonProps;

export {
  //
  Root as Button,
  Root,
};
