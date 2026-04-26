export function shouldShowPreSessionWorktreeCard(input: {
	readonly sessionId: string | null;
	readonly pendingProjectSelection: boolean;
	readonly worktreeToggleProjectPath: string | null;
	readonly hasPendingWorktreeSetup: boolean;
	readonly worktreeSetupVisible: boolean;
	readonly hasMessages: boolean;
}): boolean {
	return (
		input.sessionId === null &&
		!input.pendingProjectSelection &&
		input.worktreeToggleProjectPath !== null &&
		!input.hasPendingWorktreeSetup &&
		!input.worktreeSetupVisible &&
		!input.hasMessages
	);
}
