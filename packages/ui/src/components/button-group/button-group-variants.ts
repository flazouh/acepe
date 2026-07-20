import { tv, type VariantProps } from "tailwind-variants";

export const buttonGroupVariants = tv({
	base: "has-[>[data-slot=button-group]]:gap-2 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md flex w-fit items-stretch [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
	variants: {
		orientation: {
			horizontal:
				"overflow-hidden rounded-md [&>[data-slot=button]:first-child]:!rounded-none [&>[data-slot=button]:first-child]:!rounded-l-md [&>[data-slot=button]:last-child]:!rounded-none [&>[data-slot=button]:last-child]:!rounded-r-md [&>[data-slot=button]:not(:first-child):not(:last-child)]:!rounded-none [&>[data-slot=button]~[data-slot=button]]:border-l-0 [&>:first-child_[data-slot=button]]:!rounded-none [&>:first-child_[data-slot=button]]:!rounded-l-md [&>:first-child:not(:last-child)_[data-slot=button]]:!rounded-r-none [&>:last-child:not(:first-child)_[data-slot=button]]:!rounded-none [&>:last-child:not(:first-child)_[data-slot=button]]:!rounded-r-md [&>:last-child:not(:first-child)_[data-slot=button]]:!rounded-l-none [&>:not(:first-child):not(:last-child)_[data-slot=button]]:!rounded-none [&>:not(:first-child)_[data-slot=button]]:border-l-0",
			vertical:
				"overflow-hidden rounded-md flex-col [&>[data-slot=button]:first-child]:!rounded-none [&>[data-slot=button]:first-child]:!rounded-t-md [&>[data-slot=button]:last-child]:!rounded-none [&>[data-slot=button]:last-child]:!rounded-b-md [&>[data-slot=button]:not(:first-child):not(:last-child)]:!rounded-none [&>[data-slot=button]~[data-slot=button]]:border-t-0",
		},
	},
	defaultVariants: {
		orientation: "horizontal",
	},
});

export type ButtonGroupOrientation = VariantProps<
	typeof buttonGroupVariants
>["orientation"];
