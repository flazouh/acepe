/**
 * Pure logic for worktree toggle - no Svelte dependencies.
 * This module contains all business logic that can be unit tested.
 */

import * as m from "$lib/messages.js";

/**
 * Whether the worktree is in "pending auto-create" mode.
 * True when the global default is ON, no worktree exists yet, no messages sent, and it's a git repo.
 */
export function computeIsPending(
	globalWorktreeDefault: boolean,
	hasWorktree: boolean,
	hasMessages: boolean,
	isGitRepo: boolean | null
): boolean {
	return globalWorktreeDefault && !hasWorktree && !hasMessages && isGitRepo === true;
}

/**
 * Determine if the toggle should be disabled.
 * Disabled when: pending auto-create, session has messages, file edits, loading, or not a git repo.
 */
export function computeIsDisabled(
	hasEdits: boolean,
	loading: boolean,
	isGitRepo: boolean | null,
	isCreatingWorktree: boolean,
	hasMessages: boolean,
	isPending: boolean
): boolean {
	return (
		isPending || hasMessages || hasEdits || loading || isCreatingWorktree || isGitRepo === false
	);
}

/**
 * Get tooltip text based on current state.
 */
export function computeTooltipText(
	loading: boolean,
	isGitRepo: boolean | null,
	hasEdits: boolean,
	_enabled: boolean,
	isCreatingWorktree: boolean,
	hasMessages: boolean,
	isPending: boolean
): string {
	if (isCreatingWorktree) {
		return m.worktree_toggle_creating();
	}
	if (loading) {
		return m.worktree_toggle_checking();
	}
	if (isGitRepo === false) {
		return m.worktree_toggle_not_git_repo();
	}
	if (isPending) {
		return m.worktree_toggle_pending_tooltip();
	}
	if (hasMessages) {
		return m.worktree_toggle_has_messages();
	}
	if (hasEdits) {
		return m.worktree_toggle_disabled_tooltip();
	}
	return m.worktree_toggle_tooltip_create();
}

/**
 * Initial state values for worktree toggle.
 */
export interface WorktreeToggleValues {
	enabled: boolean;
	isGitRepo: boolean | null;
	loading: boolean;
	isCreatingWorktree: boolean;
}
