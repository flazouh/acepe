export interface WorktreeCloseConfirmationState {
	readonly confirming: boolean;
	readonly hasDirtyChanges: boolean;
	readonly dirtyCheckPending: boolean;
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
