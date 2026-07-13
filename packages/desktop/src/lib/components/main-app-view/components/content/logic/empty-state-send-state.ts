export const EMPTY_STATE_PANEL_ID = "empty-state-panel";

export function resolveEmptyStateAgentId(options: {
	selectedAgentId: string | null;
	defaultAgentId?: string | null;
	availableAgentIds: readonly string[];
}): string | null {
	// 1. Explicit user selection in current session wins
	if (options.selectedAgentId && options.availableAgentIds.includes(options.selectedAgentId)) {
		return options.selectedAgentId;
	}

	// 2. User's persisted default agent preference
	if (options.defaultAgentId && options.availableAgentIds.includes(options.defaultAgentId)) {
		return options.defaultAgentId;
	}

	// 3. First available agent
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
	projectPath: string | null | undefined;
	isProjectWorktreeEnabled: (projectPath: string) => boolean;
}): boolean {
	if (options.activeWorktreePath !== null) {
		return false;
	}

	if (!options.projectPath) {
		return false;
	}

	return options.isProjectWorktreeEnabled(options.projectPath);
}

export function resolveEmptyStateWorktreePendingForProjectChange(options: {
	projectPath: string;
	isProjectWorktreeEnabled: (projectPath: string) => boolean;
}): boolean {
	return resolveEmptyStateWorktreePending({
		activeWorktreePath: null,
		projectPath: options.projectPath,
		isProjectWorktreeEnabled: options.isProjectWorktreeEnabled,
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
