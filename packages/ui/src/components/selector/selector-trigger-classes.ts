import { cn } from "../../lib/utils.js";
import {
	FUSED_CONTROL_COMPOSER_CHIP_LABEL_BUTTON_CLASS,
	FUSED_CONTROL_COMPOSER_STANDALONE_ICON_CHIP_CLASS,
} from "../panel-header/project-card-action-button-class.js";

export type SelectorTriggerSize =
	| "default"
	| "icon"
	| "chromeIcon"
	| "chromeIconMd"
	| "square"
	| "attach"
	| "minimal"
	| "pill"
	| "footer"
	| "setupChip"
	| "setupChipIcon"
	| "headerAction";

export function getSelectorTriggerSizeClass(triggerSize: SelectorTriggerSize): string {
	switch (triggerSize) {
	case "chromeIcon":
		return "[&_svg]:block";
	case "chromeIconMd":
		return "[&_svg]:block";
	case "icon":
		return "size-5 min-w-0 shrink-0 rounded-md gap-0 !h-5 !w-5 !p-0 !px-0 !py-0 has-[>svg]:!px-0 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:block";
	case "square":
		return "h-7 w-7 shrink-0 rounded-none border-0 p-0 gap-0 text-muted-foreground hover:bg-muted/80 hover:text-foreground";
	case "attach":
		return "size-5 min-w-0 shrink-0 rounded-md gap-0 !h-5 !w-5 !p-0 !px-0 !py-0 has-[>svg]:!px-0 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:block";
	case "minimal":
		return "!border-0 !h-[26px] rounded-md gap-1.5 px-2 text-xs";
	case "pill":
		return "gap-1.5 h-7 flex-1 min-w-0 max-w-full rounded-md border-0 px-2.5 text-xs";
	case "footer":
		return "h-5 min-w-0 shrink-0 gap-1 rounded-md border-0 !px-1 has-[>svg]:!px-1 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3";
	case "setupChip":
		return FUSED_CONTROL_COMPOSER_CHIP_LABEL_BUTTON_CLASS;
	case "setupChipIcon":
		return FUSED_CONTROL_COMPOSER_STANDALONE_ICON_CHIP_CLASS;
	case "headerAction":
		return "";
	default:
		return "gap-1.5 h-7 flex-1 min-w-0 max-w-full rounded-none border-0 px-2 text-xs";
	}
}

export function getSelectorTriggerClass(input: {
	triggerSize: SelectorTriggerSize;
	triggerClass?: string;
}): string {
	return cn(getSelectorTriggerSizeClass(input.triggerSize), input.triggerClass);
}
