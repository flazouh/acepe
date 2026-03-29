export function resolveAgentPanelWorktreePending(options: {
	panelId: string | null | undefined;
	activeWorktreePath: string | null;
	hasMessages: boolean;
	globalWorktreeDefault: boolean;
	loadEnabled: (panelId: string, globalDefault: boolean) => boolean;
}): boolean {
	if (!options.panelId) {
		return false;
	}

	if (options.activeWorktreePath !== null) {
		return false;
	}

	if (options.hasMessages) {
		return false;
	}

	return options.loadEnabled(options.panelId, options.globalWorktreeDefault);
}