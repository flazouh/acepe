export function resolveAgentPanelWorktreePending(options: {
	activeWorktreePath: string | null;
	hasMessages: boolean;
	pendingWorktreeEnabled: boolean | null;
	hasPreparedWorktreeLaunch?: boolean;
}): boolean {
	if (options.activeWorktreePath !== null && options.hasPreparedWorktreeLaunch !== true) {
		return false;
	}

	if (options.hasMessages) {
		return false;
	}

	return options.pendingWorktreeEnabled === true;
}
