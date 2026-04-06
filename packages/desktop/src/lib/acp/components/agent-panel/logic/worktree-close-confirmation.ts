export interface WorktreeCloseConfirmationState {
	readonly confirming: boolean;
	readonly hasDirtyChanges: boolean;
	readonly dirtyCheckPending: boolean;
}

export interface WorktreeCloseDecision {
	readonly bypassConfirmation: boolean;
	readonly worktreePath: string | null;
	readonly worktreeDeleted: boolean;
}

export function createPendingWorktreeCloseConfirmationState(): WorktreeCloseConfirmationState {
	return {
		confirming: true,
		hasDirtyChanges: false,
		dirtyCheckPending: true,
	};
}

export function createResolvedWorktreeCloseConfirmationState(
	hasDirtyChanges: boolean
): WorktreeCloseConfirmationState {
	return {
		confirming: true,
		hasDirtyChanges,
		dirtyCheckPending: false,
	};
}

export function shouldConfirmWorktreeClose({
	bypassConfirmation,
	worktreePath,
	worktreeDeleted,
}: WorktreeCloseDecision): boolean {
	return !bypassConfirmation && worktreePath !== null && !worktreeDeleted;
}
