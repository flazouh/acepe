import { tv } from "tailwind-variants";

/** Shared interactive tokens for composer submit split-button segments. */
export const agentInputSubmitSegmentBase =
	"inline-flex h-7 shrink-0 items-center justify-center gap-0 whitespace-nowrap bg-foreground p-0 text-sm font-medium text-background transition-all outline-none hover:bg-foreground/85 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0";

export const agentInputSubmitPrimarySegmentVariants = tv({
	base: agentInputSubmitSegmentBase,
	variants: {
		split: {
			true: "w-7 cursor-pointer rounded-l-lg rounded-r-none",
			false: "w-7 cursor-pointer rounded-lg",
		},
	},
	defaultVariants: {
		split: false,
	},
});

export const agentInputSubmitMenuSegmentClass =
	"inline-flex h-7 w-5 shrink-0 cursor-pointer items-center justify-center rounded-l-none rounded-r-lg border-l border-background/20 bg-foreground p-0 text-background transition-all outline-none hover:bg-foreground/85 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0";

/** Opacity for standalone submit when disabled. */
export const agentInputSubmitStandaloneDisabledClass = "disabled:opacity-50";

export const agentInputSubmitGroupDisabledVariants = tv({
	base: "",
	variants: {
		disabled: {
			true: "opacity-50",
			false: "",
		},
	},
	defaultVariants: {
		disabled: false,
	},
});
