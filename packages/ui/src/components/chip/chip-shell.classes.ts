import { cn } from "../../lib/utils.js";

export type ChipShellDensity = "badge" | "inline" | "plain";
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
	if (density === "plain") {
		return cn(
			"inline-flex min-w-0 items-center gap-1 border-0 bg-transparent px-0 py-0 text-muted-foreground",
			interactive
				? "cursor-pointer hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
				: "",
			className,
		);
	}

	const densityClass =
		density === "inline"
			? "gap-1.5 px-1 py-0.5 text-[11px] align-middle"
			: size === "sm"
				? "gap-1.5 px-0.5 py-px text-[0.625rem]"
				: "gap-1.5 px-1 py-0.5 text-xs";

	const radiusClass = density === "inline" ? "rounded-md" : "rounded-sm";

	return cn(
		`inline-flex min-w-0 items-center ${radiusClass} border border-border/60 bg-accent text-accent-foreground`,
		densityClass,
		interactive
			? "cursor-pointer active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
			: "",
		selected ? "border-border" : "",
		className,
	);
}