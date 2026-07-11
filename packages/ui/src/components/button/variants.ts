import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
import type { Snippet } from "svelte";

import { tv, type VariantProps } from "tailwind-variants";
import type { WithElementRef } from "../../lib/utils.js";

/** Child icon/img footprint (14px) for labeled and icon-only chip controls. */
export const BUTTON_CHIP_CHILD_ICON_SELECTOR =
	"[&_svg]:size-3.5 [&_svg]:shrink-0 [&_img]:size-3.5 [&_img]:shrink-0";

/** Pixel size paired with {@link BUTTON_CHIP_CHILD_ICON_SELECTOR} for badge/img APIs. */
export const BUTTON_CHIP_ICON_SIZE_PX = 14;

/** Shared base — shadcn/ui new-york-v4 button. */
export const buttonBaseClass =
	"inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_img]:shrink-0";

/** Shadcn variant appearance tokens. */
export const buttonShadcnVariantAppearanceClass = {
	default: "bg-primary text-primary-foreground hover:bg-primary/90",
	destructive:
		"bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
	outline:
		"bg-accent/40 text-foreground hover:bg-accent/70 hover:text-accent-foreground dark:bg-input/30 dark:hover:bg-input/50",
	secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
	ghost:
		"hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground dark:hover:bg-accent/50 dark:focus-visible:bg-accent/50",
	link: "text-primary underline-offset-4 hover:underline",
} as const;

/** Shadcn size tokens — matches ui.shadcn.com docs (not new-york-v4 registry h-9 default). */
export const buttonShadcnSizeAppearanceClass = {
	default: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 [&_svg]:size-4 [&_img]:size-4",
	xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg]:size-3 [&_img]:size-3",
	sm: `h-7 gap-1 rounded-md px-2.5 text-xs leading-none font-normal has-[>svg]:px-2 ${BUTTON_CHIP_CHILD_ICON_SELECTOR}`,
	lg: "h-9 rounded-md px-4 has-[>svg]:px-3 [&_svg]:size-4 [&_img]:size-4",
	"icon-sm": `size-5 gap-0 p-0 has-[>svg]:p-0 ${BUTTON_CHIP_CHILD_ICON_SELECTOR}`,
	icon: "size-6 gap-0 p-0 has-[>svg]:p-0 [&_svg]:!size-4 [&_img]:!size-4",
	"icon-md": "size-7 gap-0 p-0 has-[>svg]:p-0 [&_svg]:size-4",
	"icon-sm-narrow": `h-7 w-6 min-w-0 shrink-0 gap-0 p-0 has-[>svg]:p-0 ${BUTTON_CHIP_CHILD_ICON_SELECTOR}`,
	"icon-lg": "size-8 gap-0 p-0 has-[>svg]:p-0 [&_svg]:size-4",
} as const;

export const buttonVariantAppearanceClass = {
	...buttonShadcnVariantAppearanceClass,
} as const;

export const buttonSizeAppearanceClass = {
	...buttonShadcnSizeAppearanceClass,
} as const;

export const buttonVariants = tv({
	base: buttonBaseClass,
	variants: {
		variant: buttonVariantAppearanceClass,
		active: {
			true: "",
			false: "",
		},
		size: buttonSizeAppearanceClass,
	},
	defaultVariants: {
		variant: "default",
		size: "default",
		active: false,
	},
	compoundVariants: [
		{
			variant: "ghost",
			size: "icon",
			active: false,
			class:
				"text-muted-foreground hover:text-foreground focus-visible:text-foreground [&_svg]:text-muted-foreground [&_svg]:transition-colors [&_svg_*]:text-muted-foreground [&_svg_*]:transition-colors hover:[&_svg]:text-foreground hover:[&_svg_*]:text-foreground focus-visible:[&_svg]:text-foreground focus-visible:[&_svg_*]:text-foreground",
		},
		{
			variant: "ghost",
			active: true,
			class: "bg-accent text-foreground",
		},
	],
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

/** Design-system variant rows — shadcn core. */
export const buttonVariantShowcaseOrder = [
	"default",
	"secondary",
	"destructive",
	"outline",
	"ghost",
	"link",
] as const satisfies readonly ButtonVariant[];

/** Design-system size columns — shadcn docs scale (default is h-8 / 32px). */
export const buttonSizeShowcaseOrder = [
	"xs",
	"sm",
	"default",
	"lg",
	"icon-sm",
	"icon",
	"icon-md",
	"icon-sm-narrow",
	"icon-lg",
] as const satisfies readonly ButtonSize[];

export type ControlTokenVariant = (typeof buttonVariantShowcaseOrder)[number];
export type ControlTokenSize = (typeof buttonSizeShowcaseOrder)[number];

export function getButtonVariantAppearanceClass(variant: ControlTokenVariant): string {
	return buttonShadcnVariantAppearanceClass[variant];
}

export function getButtonSizeAppearanceClass(size: ControlTokenSize): string {
	return buttonShadcnSizeAppearanceClass[size];
}

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
	WithElementRef<HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		active?: boolean;
		children?: Snippet;
	};
