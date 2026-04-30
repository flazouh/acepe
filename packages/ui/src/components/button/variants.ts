import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

import { tv, type VariantProps } from "tailwind-variants";
import type { WithElementRef } from "../../lib/utils.js";

export const buttonVariants = tv({
	base: "cursor-pointer inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
			/** Inverted: muted foreground bg with background text. Softer than true fg/bg inversion. */
			invert: "bg-muted-foreground text-background shadow-none hover:bg-muted-foreground/80",
			destructive:
				"bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
			outline:
				"border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
			secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
			ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
			link: "text-primary underline-offset-4 hover:underline",
			header:
				"border border-border/50 bg-background text-foreground shadow-none hover:bg-accent/40 hover:text-foreground",
			headerAction:
				"border border-border/50 bg-muted text-foreground/80 shadow-none hover:bg-muted/80 hover:text-foreground transition-colors",
			toolbar:
				"border border-border/50 bg-muted text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors",
		},
		size: {
			default: "h-9 px-4 py-2 has-[>svg]:px-3",
			sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
			lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
			header: "h-7 gap-1.5 px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
			headerAction:
				"h-auto gap-1 rounded px-2 py-0.5 text-[0.6875rem] [&_svg:not([class*='size-'])]:size-3",
			toolbar:
				"h-auto gap-1 rounded px-2 py-0.5 text-[0.6875rem] [&_svg:not([class*='size-'])]:size-3",
			icon: "size-9",
			"icon-sm": "size-8",
			"icon-lg": "size-10",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
	},
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
	WithElementRef<HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
	};
