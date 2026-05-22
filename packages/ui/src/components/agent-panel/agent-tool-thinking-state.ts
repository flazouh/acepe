export interface ThinkingPreferenceInput {
	defaultExpanded?: boolean;
	onToggleDefaultExpand?: (() => void) | undefined;
	contextDefaultExpanded?: boolean;
	contextToggleDefaultExpand?: (() => void) | undefined;
}

export interface ThinkingPreferenceState {
	defaultExpanded: boolean;
	onToggleDefaultExpand: (() => void) | undefined;
	defaultExpandLabel: string;
	defaultExpandIconWeight: "fill" | "regular";
	defaultExpandClass: string;
}

export function hasThinkingContent(hasChildren: boolean): boolean {
	return hasChildren;
}

export function getNextThinkingCollapsed(collapsed: boolean): boolean {
	return !collapsed;
}

export function getThinkingCollapseLabel(input: {
	collapsed: boolean;
	ariaExpandLabel: string;
	ariaCollapseLabel: string;
}): string {
	return input.collapsed ? input.ariaExpandLabel : input.ariaCollapseLabel;
}

export function getThinkingPreferenceState(
	input: ThinkingPreferenceInput
): ThinkingPreferenceState {
	const defaultExpanded =
		input.defaultExpanded ?? input.contextDefaultExpanded ?? false;

	return {
		defaultExpanded,
		onToggleDefaultExpand:
			input.onToggleDefaultExpand ?? input.contextToggleDefaultExpand,
		defaultExpandLabel: defaultExpanded
			? "Collapse thinking by default"
			: "Expand thinking by default",
		defaultExpandIconWeight: defaultExpanded ? "fill" : "regular",
		defaultExpandClass: defaultExpanded
			? "text-foreground"
			: "text-muted-foreground",
	};
}
