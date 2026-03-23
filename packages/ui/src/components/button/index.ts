import Root from "./button.svelte";

import type { ButtonProps } from "./variants.js";

export {
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  buttonVariants,
} from "./variants.js";

export type Props = ButtonProps;

export {
  //
  Root as Button,
  Root,
};
