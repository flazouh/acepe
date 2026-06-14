import { cn } from "../../lib/utils.js";

export function buildDropdownMenuSurfaceClassName(className?: string): string {
	return cn(
		"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
		"data-[side=bottom]:slide-in-from-top-2",
		"data-[side=left]:slide-in-from-right-2",
		"data-[side=right]:slide-in-from-start-2",
		"data-[side=top]:slide-in-from-bottom-2",
		"z-[var(--overlay-z)] max-h-(--bits-dropdown-menu-content-available-height)",
		"min-w-[8rem] overflow-y-auto overflow-x-hidden p-1",
		"bg-popover text-popover-foreground shadow-md",
		"data-[state=closed]:animate-out data-[state=open]:animate-in",
		"border border-border",
		"rounded-xl",
		className
	);
}
