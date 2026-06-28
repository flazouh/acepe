import { dropdownMenuItemRadiusClass } from "./dropdown-menu-item.classes.js";

export const dropdownMenuHighlightContainerClass =
	"relative flex flex-col gap-0.5 select-none";

export const dropdownMenuHoverLayerClass = [
	"pointer-events-none absolute",
	dropdownMenuItemRadiusClass,
	"bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)]",
	"opacity-0",
	"transition-[top,left,width,height,opacity]",
	"duration-100 ease-out",
].join(" ");

export const dropdownMenuActiveLayerClass = [
	"pointer-events-none absolute",
	dropdownMenuItemRadiusClass,
	"bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]",
	"opacity-0",
	"transition-[top,left,width,height,opacity]",
	"duration-150 ease-out",
].join(" ");

export const dropdownMenuFocusRingLayerClass = [
	"pointer-events-none absolute z-20",
	"rounded-[10px] border border-[#6B97FF]",
	"opacity-0",
	"transition-[top,left,width,height,opacity]",
	"duration-100 ease-out",
].join(" ");

export function applyDropdownMenuLayerStyle(
	element: HTMLElement,
	rect: { top: number; left: number; width: number; height: number } | null,
	options?: { inset?: number; opacity?: number },
): void {
	if (!rect) {
		element.style.opacity = "0";
		return;
	}

	const inset = options?.inset ?? 0;
	element.style.top = `${rect.top - inset}px`;
	element.style.left = `${rect.left - inset}px`;
	element.style.width = `${rect.width + inset * 2}px`;
	element.style.height = `${rect.height + inset * 2}px`;
	element.style.opacity = `${options?.opacity ?? 1}`;
}
