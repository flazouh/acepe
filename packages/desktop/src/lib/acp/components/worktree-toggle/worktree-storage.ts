/**
 * Worktree toggle persistence.
 *
 * Per-panel overrides use localStorage (transient, cleared on panel close).
 * Global default uses SQLite via tauriClient.settings (persistent user preference).
 */

import type { ResultAsync } from "neverthrow";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { AppError } from "../../errors/app-error.js";

// ── Per-panel localStorage (transient overrides) ──

const STORAGE_KEY_PREFIX = "acepe:worktree-enabled";

function getStorageKey(panelId: string): string {
	return `${STORAGE_KEY_PREFIX}:${panelId}`;
}

/**
 * Load worktree enabled state for a panel.
 * Falls back to globalDefault when the per-panel key has never been explicitly set.
 */
export function loadWorktreeEnabled(panelId: string, globalDefault: boolean): boolean {
	const stored = localStorage.getItem(getStorageKey(panelId));
	if (stored === null) return globalDefault;
	return stored === "true";
}

export function saveWorktreeEnabled(panelId: string, enabled: boolean): void {
	localStorage.setItem(getStorageKey(panelId), String(enabled));
}

export function clearWorktreeEnabled(panelId: string): void {
	localStorage.removeItem(getStorageKey(panelId));
}

// ── Global default (SQLite-backed user preference) ──

const GLOBAL_DEFAULT_KEY: UserSettingKey = "worktree_global_default_enabled";

export function loadWorktreeDefault(): ResultAsync<boolean, AppError> {
	return tauriClient.settings.get<boolean>(GLOBAL_DEFAULT_KEY).map((v) => v ?? false);
}

export function saveWorktreeDefault(enabled: boolean): ResultAsync<void, AppError> {
	return tauriClient.settings.set(GLOBAL_DEFAULT_KEY, enabled);
}
