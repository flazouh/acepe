import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
import { tv, type VariantProps } from "tailwind-variants";
import { SoundEffect } from "$lib/acp/types/sounds.js";
import type { WithElementRef } from "$lib/utils.js";

export const buttonVariants = tv({
	base: "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_img]:shrink-0",
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground hover:bg-primary/90",
			destructive:
				"bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
			outline:
				"border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
			secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
			ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
			link: "text-primary underline-offset-4 hover:underline",
		},
		size: {
			default: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 [&_svg]:size-4 [&_img]:size-4",
			xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg]:size-3 [&_img]:size-3",
			sm: "h-7 gap-1 rounded-md px-2.5 text-xs leading-none font-normal has-[>svg]:px-2 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_img]:size-3.5 [&_img]:shrink-0",
			lg: "h-9 rounded-md px-4 has-[>svg]:px-3 [&_svg]:size-4 [&_img]:size-4",
			"icon-sm":
				"size-5 gap-0 p-0 has-[>svg]:p-0 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_img]:size-3.5 [&_img]:shrink-0",
			icon: "size-6 gap-0 p-0 has-[>svg]:p-0 [&_svg]:!size-4 [&_img]:!size-4",
			"icon-md": "size-7 gap-0 p-0 has-[>svg]:p-0 [&_svg]:size-4",
			"icon-sm-narrow":
				"h-7 w-6 min-w-0 shrink-0 gap-0 p-0 has-[>svg]:p-0 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_img]:size-3.5 [&_img]:shrink-0",
			"icon-lg": "size-8 gap-0 p-0 has-[>svg]:p-0 [&_svg]:size-4",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
	},
	compoundVariants: [
		{
			variant: "ghost",
			size: "icon",
			class:
				"text-muted-foreground hover:text-foreground focus-visible:text-foreground [&_svg]:text-muted-foreground [&_svg]:transition-colors [&_svg_*]:text-muted-foreground [&_svg_*]:transition-colors hover:[&_svg]:text-foreground hover:[&_svg_*]:text-foreground focus-visible:[&_svg]:text-foreground focus-visible:[&_svg_*]:text-foreground",
		},
	],
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
	WithElementRef<HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		soundEffect?: SoundEffect | null;
	};

export { SoundEffect };
