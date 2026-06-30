import { cn } from "../../lib/utils.js";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./variants.js";

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
