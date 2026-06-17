export type WorktreeLaunchMode = "local" | "worktree";

export interface PreSessionWorktreeModeOption {
	readonly id: WorktreeLaunchMode;
	readonly label: string;
}

export function getPreSessionWorktreeMode(input: {
	pendingWorktreeEnabled: boolean;
}): WorktreeLaunchMode {
	return input.pendingWorktreeEnabled ? "worktree" : "local";
}

export function getPreSessionWorktreeModeOptions(input: {
	localLabel: string;
	worktreeLabel: string;
}): readonly [PreSessionWorktreeModeOption, PreSessionWorktreeModeOption] {
	return [
		{ id: "local", label: input.localLabel },
		{ id: "worktree", label: input.worktreeLabel },
	];
}

export function getSelectedPreSessionWorktreeModeOption(input: {
	mode: WorktreeLaunchMode;
	modeOptions: readonly PreSessionWorktreeModeOption[];
}): PreSessionWorktreeModeOption {
	return (
		input.modeOptions.find((option) => option.id === input.mode) ?? input.modeOptions[0]
	);
}

export function getPreSessionWorktreeIconClass(input: {
	mode: WorktreeLaunchMode;
}): string {
	return input.mode === "worktree" ? "text-success" : "text-muted-foreground";
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
