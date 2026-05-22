export type CopyButtonVariant = "inline" | "footer" | "icon" | "menu" | "embedded";

export interface CopyButtonDisplayState {
	isControlled: boolean;
	isFooter: boolean;
	isIcon: boolean;
	isMenu: boolean;
	isEmbedded: boolean;
	isInlineWithLabel: boolean;
	copied: boolean;
	baseClass: string;
	colorClass: string;
	title: string;
	showLabel: boolean;
	labelClass: string;
}

export function buildCopyButtonDisplayState(input: {
	variant: CopyButtonVariant;
	label?: string;
	onClick?: (() => void) | undefined;
	controlledCopied?: boolean;
	internalCopied: boolean;
	titleOverride?: string;
}): CopyButtonDisplayState {
	const isControlled = input.onClick !== undefined;
	const copied = isControlled ? (input.controlledCopied ?? false) : input.internalCopied;
	const flags = getCopyButtonVariantFlags(input.variant, input.label);

	return {
		...flags,
		isControlled,
		copied,
		baseClass: getCopyButtonBaseClass(flags),
		colorClass: getCopyButtonColorClass({ copied, isFooter: flags.isFooter }),
		title: copied ? "Copied!" : (input.titleOverride ?? "Copy"),
		showLabel: (flags.isMenu || flags.isInlineWithLabel) && Boolean(input.label),
		labelClass: flags.isInlineWithLabel ? "truncate" : "",
	};
}

export function getCopyButtonVariantFlags(variant: CopyButtonVariant, label?: string) {
	return {
		isFooter: variant === "footer",
		isIcon: variant === "icon",
		isMenu: variant === "menu",
		isEmbedded: variant === "embedded",
		isInlineWithLabel: variant === "inline" && Boolean(label),
	};
}

function getCopyButtonBaseClass(flags: ReturnType<typeof getCopyButtonVariantFlags>): string {
	if (flags.isEmbedded) {
		return "h-7 w-7 inline-flex items-center justify-center text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-50 disabled:pointer-events-none";
	}

	if (flags.isFooter) {
		return "inline-flex items-center justify-center p-0.5 rounded-full hover:bg-accent transition-colors";
	}

	if (flags.isMenu) {
		return "w-full justify-start gap-2 flex items-center cursor-pointer border-none bg-transparent font-inherit text-inherit px-2 py-1 text-[11px] font-medium -mx-2 -my-1";
	}

	if (flags.isInlineWithLabel) {
		return "inline-flex items-center gap-1 p-0 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 font-medium";
	}

	if (flags.isIcon) {
		return "inline-flex items-center justify-center p-0.5 rounded transition-colors text-muted-foreground/50 hover:text-foreground";
	}

	return "inline-flex items-center justify-center p-0.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 shrink-0";
}

function getCopyButtonColorClass(input: { copied: boolean; isFooter: boolean }): string {
	if (input.copied) {
		return "text-emerald-500";
	}

	return input.isFooter ? "text-muted-foreground hover:text-foreground" : "";
}
