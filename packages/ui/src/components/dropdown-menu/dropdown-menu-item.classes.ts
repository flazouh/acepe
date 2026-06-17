export const dropdownMenuItemRadiusClass = "rounded-lg";

export function buildDropdownMenuItemClassName(hasHighlightContext: boolean): string {
	return [
		hasHighlightContext
			? "bg-transparent text-popover-foreground hover:text-accent-foreground focus:text-accent-foreground data-[highlighted]:text-accent-foreground"
			: "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
		"transition-colors duration-75 ease-out",
		"relative z-10",
		"data-[selected]:bg-accent data-[selected]:text-accent-foreground",
		"aria-selected:bg-accent aria-selected:text-accent-foreground",
		"data-[variant=destructive]:text-destructive",
		"data-[variant=destructive]:data-highlighted:bg-destructive/10",
		"dark:data-[variant=destructive]:data-highlighted:bg-destructive/20",
		"data-[variant=destructive]:data-highlighted:text-destructive",
		"data-[variant=destructive]:*:[svg]:!text-destructive",
		`relative flex cursor-default items-center gap-2 ${dropdownMenuItemRadiusClass}`,
		"px-2 py-1 text-[11px] font-medium",
		"outline-hidden select-none",
		"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
		"data-[inset]:ps-8",
		"[&_svg:not([class*='text-'])]:text-muted-foreground",
		"hover:[&_svg:not([class*='text-'])]:text-current",
		"focus:[&_svg:not([class*='text-'])]:text-current",
		"data-[highlighted]:[&_svg:not([class*='text-'])]:text-current",
		"data-[selected]:[&_svg:not([class*='text-'])]:text-current",
		"aria-selected:[&_svg:not([class*='text-'])]:text-current",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	].join(" ");
}
