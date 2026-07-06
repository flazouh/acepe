import { cn } from "../../lib/utils.js";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./variants.js";

export type HeaderIconCloseSize = Extract<ButtonSize, "icon">;

export function getButtonClass(input: {
	variant?: ButtonVariant;
	size?: ButtonSize;
	active?: boolean;
	class?: string;
}): string {
	return cn(
		buttonVariants({
			variant: input.variant,
			size: input.size,
			active: input.active,
		}),
		input.class
	);
}

/** Dialog close control matching ghost header icon buttons. */
export function getDialogHeaderIconCloseClass(
	size: HeaderIconCloseSize = "icon"
): string {
	return cn(
		buttonVariants({ variant: "ghost", size, active: false }),
		"border-0 shadow-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
	);
}
