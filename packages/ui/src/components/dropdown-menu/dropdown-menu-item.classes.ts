import {
	dropdownMenuItemTypographyClass,
} from "./dropdown-menu-typography.js";

export const dropdownMenuItemRadiusClass = "rounded-lg";

export function buildDropdownMenuItemClassName(
	hasHighlightContext: boolean,
	options?: { inset?: boolean },
): string {
	const padding = options?.inset ? "py-2 ps-8 pe-2" : "px-2 py-2";

	return [
		hasHighlightContext
			? [
					"bg-transparent text-muted-foreground",
					"hover:text-foreground focus:text-foreground",
					"data-[highlighted]:text-foreground",
					"data-[proximity-active]:text-foreground",
					"data-[state=open]:text-foreground",
				].join(" ")
			: [
					"text-muted-foreground hover:bg-accent hover:text-accent-foreground",
					"focus:bg-accent focus:text-accent-foreground",
					"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
				].join(" "),
		"dropdown-menu-weight-shift",
		"relative z-10",
		"data-[variant=destructive]:text-destructive",
		"data-[variant=destructive]:data-highlighted:bg-destructive/10",
		"dark:data-[variant=destructive]:data-highlighted:bg-destructive/20",
		"data-[variant=destructive]:data-highlighted:text-destructive",
		"data-[variant=destructive]:*:[svg]:!text-destructive",
		`relative flex cursor-default items-center gap-2 ${dropdownMenuItemRadiusClass}`,
		`${padding} ${dropdownMenuItemTypographyClass}`,
		"outline-hidden select-none",
		"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
		"data-[inset]:ps-8",
		"[&_svg:not([class*='text-'])]:text-muted-foreground",
		"hover:[&_svg:not([class*='text-'])]:text-current",
		"focus:[&_svg:not([class*='text-'])]:text-current",
		"data-[highlighted]:[&_svg:not([class*='text-'])]:text-current",
		"data-[proximity-active]:[&_svg:not([class*='text-'])]:text-current",
		"data-[state=open]:[&_svg:not([class*='text-'])]:text-current",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	].join(" ");
}

export function buildDropdownMenuInsetItemClassName(hasHighlightContext: boolean): string {
	return buildDropdownMenuItemClassName(hasHighlightContext, { inset: true });
}
