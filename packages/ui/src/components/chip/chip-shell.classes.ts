import { cn } from "../../lib/utils.js";

export type ChipShellDensity = "badge" | "inline";
export type ChipShellSize = "default" | "sm";

interface ChipShellClassOptions {
	density?: ChipShellDensity;
	size?: ChipShellSize;
	interactive?: boolean;
	selected?: boolean;
	className?: string;
}

export function buildChipShellClassName({
	density = "badge",
	size = "default",
	interactive = false,
	selected = false,
	className = "",
}: ChipShellClassOptions): string {
	const densityClass =
		density === "inline"
			? "gap-1.5 px-1 py-0.5 text-[11px] align-middle"
			: size === "sm"
				? "gap-1.5 px-0.5 py-px text-[0.625rem]"
				: "gap-1.5 px-1 py-0.5 text-xs";

	const radiusClass = density === "inline" ? "rounded-md" : "rounded-sm";

	return cn(
		`inline-flex min-w-0 items-center ${radiusClass} border border-border/50 bg-muted text-muted-foreground`,
		densityClass,
		interactive
			? "cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
			: "",
		selected ? "bg-accent text-accent-foreground" : "",
		className,
	);
}