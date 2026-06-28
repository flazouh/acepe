import { dropdownSurfaceClasses } from "../../lib/surface-classes.js";
import { cn } from "../../lib/utils.js";

export function buildDropdownMenuSurfaceClassName(
	className?: string,
	substrateLevel: number = 1,
): string {
	return cn(
		dropdownSurfaceClasses(substrateLevel),
		"z-[var(--overlay-z)] max-h-(--bits-dropdown-menu-content-available-height)",
		"min-w-[8rem] overflow-y-auto overflow-x-hidden p-1",
		"text-popover-foreground",
		"rounded-xl",
		className,
	);
}
