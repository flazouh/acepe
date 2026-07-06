import { cn } from "../../lib/utils.js";
import { BUTTON_CHIP_CHILD_ICON_SELECTOR } from "../button/variants.js";
import type { ButtonSize, ButtonVariant } from "../button/variants.js";

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
	| "setupBarChip"
	| "setupBarChipGrouped"
	| "composerChipLabel"
	| "composerChipIcon"
	| "headerAction";

/** Normalize trigger size names (identity today; kept for call-site stability). */
export function resolveSelectorTriggerSize(triggerSize: SelectorTriggerSize): SelectorTriggerSize {
	return triggerSize;
}

export function isFusedComposerChipTriggerSize(triggerSize: SelectorTriggerSize): boolean {
	const resolved = resolveSelectorTriggerSize(triggerSize);
	return (
		resolved === "composerChipIcon" ||
		resolved === "composerChipLabel" ||
		resolved === "setupBarChip" ||
		resolved === "setupBarChipGrouped"
	);
}

/** Button variant for Selector triggers. */
export function getSelectorTriggerButtonVariant(triggerSize: SelectorTriggerSize): ButtonVariant {
	if (isFusedComposerChipTriggerSize(triggerSize)) {
		const resolved = resolveSelectorTriggerSize(triggerSize);
		return resolved === "composerChipIcon" ? "ghost" : "secondary";
	}

	const resolved = resolveSelectorTriggerSize(triggerSize);

	switch (resolved) {
	case "chromeIcon":
	case "chromeIconMd":
	case "icon":
	case "attach":
	case "square":
		return "ghost";
	case "headerAction":
		return "secondary";
	case "pill":
	case "minimal":
	case "footer":
	case "default":
		return "ghost";
	default:
		return "outline";
	}
}

/** Button size for Selector triggers. */
export function getSelectorTriggerButtonSize(triggerSize: SelectorTriggerSize): ButtonSize {
	const resolved = resolveSelectorTriggerSize(triggerSize);

	if (resolved === "composerChipIcon") {
		return "icon-sm";
	}
	if (isFusedComposerChipTriggerSize(resolved)) {
		return "sm";
	}
	if (resolved === "chromeIconMd") {
		return "icon-2xs";
	}
	if (resolved === "chromeIcon") {
		return "icon-2xs";
	}
	if (resolved === "icon" || resolved === "attach" || resolved === "square") {
		return "icon-2xs";
	}
	if (resolved === "headerAction") {
		return "xs";
	}
	return "sm";
}

export interface SelectorTriggerButtonProps {
	variant: ButtonVariant;
	size: ButtonSize;
}

/** Variant + size for Selector triggers, including fused ButtonGroup context. */
export function getSelectorTriggerButtonPropsForContext(input: {
	triggerSize: SelectorTriggerSize;
	embeddedInGroup: boolean;
	variant?: ButtonVariant;
}): SelectorTriggerButtonProps {
	const resolved = resolveSelectorTriggerSize(input.triggerSize);

	if (input.embeddedInGroup && resolved === "composerChipIcon") {
		return { variant: "secondary", size: "icon-sm-narrow" };
	}

	if (isFusedComposerChipTriggerSize(resolved)) {
		return {
			variant: getSelectorTriggerButtonVariant(resolved),
			size: getSelectorTriggerButtonSize(resolved),
		};
	}

	const fallbackVariant = input.variant ?? getSelectorTriggerButtonVariant(resolved);
	return {
		variant: fallbackVariant,
		size: getSelectorTriggerButtonSize(resolved),
	};
}

export function getSelectorTriggerButtonSizeForContext(input: {
	triggerSize: SelectorTriggerSize;
	embeddedInGroup: boolean;
}): ButtonSize {
	return getSelectorTriggerButtonPropsForContext(input).size;
}

const CHIP_TRIGGER_CHILD_SVG_CLASS = BUTTON_CHIP_CHILD_ICON_SELECTOR;

export function getSelectorTriggerSizeClass(triggerSize: SelectorTriggerSize): string {
	switch (resolveSelectorTriggerSize(triggerSize)) {
	case "chromeIcon":
	case "chromeIconMd":
	case "icon":
	case "attach":
	case "square":
		return "[&_svg]:block";
	case "minimal":
		return "!border-0 !h-[26px] rounded-md gap-1.5 px-2 text-xs";
	case "pill":
		return "gap-1.5 h-7 flex-1 min-w-0 max-w-full rounded-md border-0 px-2.5 text-xs";
	case "footer":
		return "h-5 min-w-0 shrink-0 gap-1 rounded-md border-0 !px-1 has-[>svg]:!px-1 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3";
	case "setupBarChip":
	case "setupBarChipGrouped":
	case "composerChipLabel":
	case "composerChipIcon":
		return CHIP_TRIGGER_CHILD_SVG_CLASS;
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
