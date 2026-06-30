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
  buttonLegacyVariantAppearanceClass,
  buttonLegacySizeAppearanceClass,
  getButtonVariantAppearanceClass,
  getButtonSizeAppearanceClass,
} from "./variants.js";

export { getButtonClass } from "./button-class.js";

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
