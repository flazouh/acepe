export type WorktreeToggleValue = "yes" | "no";

export function isPreSessionWorktreeOn(input: {
	pendingWorktreeEnabled: boolean;
	alwaysEnabled: boolean;
}): boolean {
	return input.pendingWorktreeEnabled || input.alwaysEnabled;
}

export function getPreSessionWorktreeToggleValue(input: {
	pendingWorktreeEnabled: boolean;
	alwaysEnabled: boolean;
}): WorktreeToggleValue {
	return isPreSessionWorktreeOn(input) ? "yes" : "no";
}

export function getPreSessionWorktreeToggleItems(input: {
	yesLabel: string;
	noLabel: string;
}): readonly [
	{ readonly id: "yes"; readonly label: string },
	{ readonly id: "no"; readonly label: string },
] {
	return [
		{ id: "yes", label: input.yesLabel },
		{ id: "no", label: input.noLabel },
	];
}

export function getPreSessionWorktreeIconClass(input: {
	worktreeOn: boolean;
	alwaysEnabled: boolean;
}): string {
	if (input.alwaysEnabled) return "text-purple-400";
	return input.worktreeOn ? "text-success" : "text-destructive";
}

export function shouldShowPreSessionWorktreeExpanded(input: {
	isExpanded: boolean;
	hasExpandable: boolean;
}): boolean {
	return input.isExpanded && input.hasExpandable;
}

export function getPreSessionWorktreeLockedWidth(input: {
	showExpanded: boolean;
	expandedWidth: number | null;
}): string | null {
	if (!input.showExpanded || input.expandedWidth === null) return null;
	return `${input.expandedWidth}px`;
}
