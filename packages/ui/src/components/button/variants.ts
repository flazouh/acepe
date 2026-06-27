import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

import { tv, type VariantProps } from "tailwind-variants";
import type { WithElementRef } from "../../lib/utils.js";

export const buttonVariants = tv({
	base: "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground hover:bg-primary/90",
			/** Inverted: muted foreground bg with background text. Softer than true fg/bg inversion. */
			invert: "bg-muted-foreground text-background shadow-none hover:bg-muted-foreground/80",
			destructive:
				"bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
			outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
			secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
			ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
			link: "text-primary underline-offset-4 hover:underline",
			header:
				"border border-border/50 bg-background text-foreground shadow-none hover:bg-accent/40 hover:text-foreground",
			headerAction:
				"border border-border/50 bg-secondary text-secondary-foreground shadow-none hover:bg-secondary/80 transition-colors",
			/** High-contrast header CTA: foreground fill, background text. */
			headerProminent:
				"border-0 bg-foreground text-background shadow-none hover:bg-foreground/90 hover:text-background transition-colors",
			toolbar:
				"border border-border/50 bg-muted text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors",
			/** Muted icon chrome for app header/footer rails (GitHub, settings, sidebar toggle, etc.). */
			chromeIcon:
				"border-0 bg-transparent text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground transition-colors",
		},
		active: {
			true: "",
			false: "",
		},
		size: {
			default: "h-9 px-4 py-2 has-[>svg]:px-3",
			"2xs": "h-5 gap-0.5 rounded-sm px-2 text-[10px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-2.5",
			xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
			sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
			lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
			header: "h-7 gap-1.5 px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
			headerAction:
				"h-auto gap-1 rounded-md px-1.5 py-px text-[0.6875rem] [&_svg:not([class*='size-'])]:size-3",
			toolbar:
				"h-auto gap-1 rounded px-2 py-0.5 text-[0.6875rem] [&_svg:not([class*='size-'])]:size-3",
			setupChip:
				"h-auto gap-1 rounded-md border-0 px-0 py-0 text-xs leading-none [&_svg:not([class*='size-'])]:size-[15px]",
			icon: "size-9",
			"icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
			"icon-sm": "size-8",
			"icon-lg": "size-10",
			/** 20px chrome icon button (sidebar footer social links). */
			chromeIcon: "size-5 gap-0 p-0 [&_svg:not([class*='size-'])]:size-3.5",
			/** 20px-tall chrome trigger with room for an inline meter (AI usage). */
			chromeIconMeter:
				"h-5 min-h-5 w-auto gap-1 rounded-md px-1 py-0 [&_svg:not([class*='size-'])]:size-3.5",
			/** 24px chrome icon button (app top bar actions). */
			chromeIconMd: "size-6 gap-0 p-0 [&_svg:not([class*='size-'])]:size-4",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
		active: false,
	},
	compoundVariants: [
		{
			variant: "chromeIcon",
			active: true,
			class: "bg-accent text-foreground",
		},
	],
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
	WithElementRef<HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		active?: boolean;
	};
