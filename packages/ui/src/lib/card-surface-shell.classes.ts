import { cn } from "./utils.js";

/** Matches toast / floating card shell radius (`--radius-lg`). */
export const cardSurfaceShellRadiusClass = "rounded-lg";

/** Shared card shell used by toast, tooltip, and similar floating surfaces. */
export function buildCardSurfaceShellClassName(className?: string): string {
	return cn(
		"border-none bg-card text-card-foreground",
		cardSurfaceShellRadiusClass,
		"backdrop-blur-[12px]",
		"shadow-[0_14px_42px_rgb(0_0_0/0.24)]",
		className
	);
}
