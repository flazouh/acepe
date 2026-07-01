import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
import type { Snippet } from "svelte";

import { tv, type VariantProps } from "tailwind-variants";
import type { WithElementRef } from "../../lib/utils.js";

/** Shared base — shadcn/ui new-york-v4 button. */
export const buttonBaseClass =
	"inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/** Shadcn variant appearance tokens. */
export const buttonShadcnVariantAppearanceClass = {
	default: "bg-primary text-primary-foreground hover:bg-primary/90",
	destructive:
		"bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
	outline:
		"border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
	secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
	ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
	link: "text-primary underline-offset-4 hover:underline",
} as const;

/** Shadcn size tokens — matches ui.shadcn.com docs (not new-york-v4 registry h-9 default). */
export const buttonShadcnSizeAppearanceClass = {
	default: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
	xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
	sm: "h-7 gap-1 rounded-md px-2.5 text-xs has-[>svg]:px-2",
	lg: "h-9 rounded-md px-4 has-[>svg]:px-3",
	icon: "size-8",
	"icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
	"icon-2xs": "size-5 gap-0 p-0 has-[>svg]:p-0 [&_svg:not([class*='size-'])]:size-3.5",
	"icon-chrome": "size-6 gap-0 p-0 has-[>svg]:p-0 [&_svg:not([class*='size-'])]:size-4",
	"icon-sm": "size-7",
	"icon-sm-narrow": "h-7 w-6 min-w-0 shrink-0 gap-0 p-0 has-[>svg]:p-0",
	"icon-lg": "size-9",
} as const;

/** @deprecated Acepe legacy — migrate to shadcn tokens. */
export const buttonLegacyVariantAppearanceClass = {
	invert: "bg-muted-foreground text-background shadow-none hover:bg-muted-foreground/80",
	header:
		"border border-border/50 bg-background text-foreground shadow-none hover:bg-accent/40 hover:text-foreground",
	headerAction:
		"border border-border/50 bg-secondary text-secondary-foreground shadow-none hover:bg-secondary/80 transition-colors",
	headerProminent:
		"border-0 bg-foreground text-background shadow-none hover:bg-foreground/90 hover:text-background transition-colors",
	toolbar:
		"border border-border/50 bg-muted text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors",
	chromeIcon:
		"border-0 bg-transparent text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground transition-colors",
} as const;

/** @deprecated Acepe legacy — migrate to shadcn tokens. */
export const buttonLegacySizeAppearanceClass = {
	"2xs": "h-5 gap-0.5 rounded-sm px-2 text-[10px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-2.5",
	header: "h-7 gap-1.5 px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
	headerAction:
		"h-auto gap-1 rounded-md px-1.5 py-px text-[0.6875rem] [&_svg:not([class*='size-'])]:size-3",
	toolbar: "h-auto gap-1 rounded px-2 py-0.5 text-[0.6875rem] [&_svg:not([class*='size-'])]:size-3",
	setupChip:
		"h-auto gap-1 rounded-md border-0 px-0 py-0 text-xs leading-none [&_svg:not([class*='size-'])]:size-[15px]",
	chromeIcon: "size-6 gap-0 p-0 [&_svg:not([class*='size-'])]:size-4",
	chromeIconMeter:
		"h-5 min-h-5 w-auto gap-1 rounded-md px-1 py-0 [&_svg:not([class*='size-'])]:size-3.5",
	chromeIconMd: "size-6 gap-0 p-0 [&_svg:not([class*='size-'])]:size-4",
} as const;

export const buttonVariantAppearanceClass = {
	...buttonShadcnVariantAppearanceClass,
	...buttonLegacyVariantAppearanceClass,
} as const;

export const buttonSizeAppearanceClass = {
	...buttonShadcnSizeAppearanceClass,
	...buttonLegacySizeAppearanceClass,
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
			size: "icon-chrome",
			active: false,
			class:
				"text-muted-foreground/55 hover:text-foreground focus-visible:text-foreground [&_svg]:text-muted-foreground/55 [&_svg]:transition-colors hover:[&_svg]:text-foreground focus-visible:[&_svg]:text-foreground",
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
	"icon-xs",
	"icon-2xs",
	"icon-chrome",
	"icon-sm",
	"icon-sm-narrow",
	"icon",
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
