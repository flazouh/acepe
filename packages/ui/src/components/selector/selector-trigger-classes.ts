import { cn } from "../../lib/utils.js";

export type SelectorTriggerSize =
	| "default"
	| "icon"
	| "square"
	| "attach"
	| "minimal"
	| "pill"
	| "footer"
	| "setupChip"
	| "headerAction";

export function getSelectorTriggerSizeClass(triggerSize: SelectorTriggerSize): string {
	switch (triggerSize) {
	case "icon":
		return "size-5 min-w-0 shrink-0 rounded-md gap-0 p-0 text-muted-foreground hover:bg-accent hover:text-foreground";
	case "square":
		return "h-7 w-7 shrink-0 rounded-none border-0 p-0 gap-0 text-muted-foreground hover:bg-muted/80 hover:text-foreground";
	case "attach":
		return "size-5 min-w-0 shrink-0 rounded-md gap-0 !p-0";
	case "minimal":
		return "!border-0 !h-[26px] rounded-md gap-1.5 px-2 text-[11px]";
	case "pill":
		return "gap-1.5 h-7 flex-1 min-w-0 max-w-full rounded-md border-0 px-2.5 text-[11px]";
	case "footer":
		return "h-5 min-w-0 shrink-0 gap-1 rounded-md border-0 !px-1 has-[>svg]:!px-1 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3";
	case "setupChip":
		return "h-auto shrink-0 gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-xs leading-none w-auto flex-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
	case "headerAction":
		return "";
	default:
		return "gap-1.5 h-7 flex-1 min-w-0 max-w-full rounded-none border-0 px-2 text-[11px]";
	}
}

export function getSelectorTriggerClass(input: {
	triggerSize: SelectorTriggerSize;
	triggerClass?: string;
}): string {
	return cn(getSelectorTriggerSizeClass(input.triggerSize), input.triggerClass);
}
