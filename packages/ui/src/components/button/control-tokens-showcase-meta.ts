import {
	buttonSizeShowcaseOrder,
	buttonVariantShowcaseOrder,
	type ButtonSize,
	type ButtonVariant,
	type ControlTokenSize,
	type ControlTokenVariant,
} from "./variants.js";

export const controlTokensShowcaseMeta = {
	title: "Button variants",
	description: "shadcn/ui tokens. Default size is default (h-8, 32px — matches ui.shadcn.com). Chrome icon controls use ghost+icon-chrome; dense inline row actions stay on icon-2xs.",
};

export interface ButtonVariantShowcaseEntry {
	readonly variant: ControlTokenVariant;
	readonly description: string;
}

const buttonVariantShowcaseDescriptions: Record<ControlTokenVariant, string> = {
	default: "Primary confirm and submit",
	secondary: "Secondary emphasis",
	destructive: "Irreversible or dangerous actions",
	outline: "Bordered neutral — cancel and secondary actions",
	ghost: "No resting fill — low-emphasis controls",
	link: "Inline text actions",
};

export const buttonVariantShowcaseEntries: readonly ButtonVariantShowcaseEntry[] =
	buttonVariantShowcaseOrder.map((variant) => ({
		variant,
		description: buttonVariantShowcaseDescriptions[variant],
	}));

/** Minimum column width so labeled buttons never overlap adjacent cells. */
export const buttonSizeShowcaseColumnMinWidth: Record<ControlTokenSize, string> = {
	xs: "5.25rem",
	sm: "6.25rem",
	default: "6.75rem",
	lg: "7.75rem",
	"icon-xs": "4rem",
	"icon-2xs": "3.75rem",
	"icon-chrome": "4.5rem",
	"icon-sm": "4.5rem",
	"icon-sm-narrow": "4rem",
	icon: "4.75rem",
	"icon-lg": "5.25rem",
};

const variantSampleLabel: Record<ControlTokenVariant, string> = {
	default: "Continue",
	secondary: "Secondary",
	destructive: "Delete",
	outline: "Cancel",
	ghost: "Ghost",
	link: "Learn more",
};

export type ButtonShowcaseDisplay =
	| { readonly kind: "icon" }
	| { readonly kind: "text"; readonly label: string };

function isIconOnlyButtonSize(size: ButtonSize): boolean {
	return (
		size === "icon-xs" ||
		size === "icon-2xs" ||
		size === "icon-chrome" ||
		size === "icon-sm" ||
		size === "icon-sm-narrow" ||
		size === "icon" ||
		size === "icon-lg"
	);
}

export function getButtonShowcaseDisplay(
	variant: ButtonVariant,
	size: ButtonSize
): ButtonShowcaseDisplay {
	if (isIconOnlyButtonSize(size)) {
		return { kind: "icon" };
	}
	return { kind: "text", label: variantSampleLabel[variant as ControlTokenVariant] };
}

export { buttonSizeShowcaseOrder, buttonVariantShowcaseOrder };
