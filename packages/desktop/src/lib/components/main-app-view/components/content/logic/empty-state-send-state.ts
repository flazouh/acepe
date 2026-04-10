export const EMPTY_STATE_PANEL_ID = "empty-state-panel";

export function resolveEmptyStateAgentId(options: {
	selectedAgentId: string | null;
	availableAgentIds: readonly string[];
}): string | null {
	if (options.selectedAgentId && options.availableAgentIds.includes(options.selectedAgentId)) {
		return options.selectedAgentId;
	}

	const firstAvailableAgentId = options.availableAgentIds[0];
	return firstAvailableAgentId ? firstAvailableAgentId : null;
}

export function canSendWithoutSession(options: {
	projectPath: string | null | undefined;
	selectedAgentId: string | null | undefined;
}): boolean {
	return Boolean(options.projectPath) && Boolean(options.selectedAgentId);
}

export function resolveEmptyStateWorktreePending(options: {
	activeWorktreePath: string | null;
	globalWorktreeDefault: boolean;
	loadEnabled: (panelId: string, globalDefault: boolean) => boolean;
	panelId?: string;
}): boolean {
	if (options.activeWorktreePath !== null) {
		return false;
	}

	return options.loadEnabled(
		options.panelId ?? EMPTY_STATE_PANEL_ID,
		options.globalWorktreeDefault
	);
}

export function resolveEmptyStateWorktreePendingForProjectChange(options: {
	globalWorktreeDefault: boolean;
	loadEnabled: (panelId: string, globalDefault: boolean) => boolean;
	panelId?: string;
}): boolean {
	return resolveEmptyStateWorktreePending({
		activeWorktreePath: null,
		globalWorktreeDefault: options.globalWorktreeDefault,
		loadEnabled: options.loadEnabled,
		panelId: options.panelId,
	});
}

export function shouldShowOptimisticConnecting(options: {
	hasSession: boolean;
	hasPendingUserEntry: boolean;
}): boolean {
	return !options.hasSession && options.hasPendingUserEntry;
}

export function shouldClearPersistedDraftBeforeAsyncSend(options: {
	panelId?: string;
	sessionId?: string | null;
}): boolean {
	return Boolean(options.panelId) && !options.sessionId;
}

export function shouldRestoreInitialDraft(options: {
	panelId?: string;
	sessionId?: string | null;
	draft: string;
	hasPendingUserEntry?: boolean;
}): boolean {
	return (
		Boolean(options.panelId) &&
		!options.sessionId &&
		!options.hasPendingUserEntry &&
		options.draft.length > 0
	);
}
