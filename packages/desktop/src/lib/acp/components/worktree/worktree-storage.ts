/**
 * Worktree toggle persistence.
 *
 * Per-project defaults use SQLite via tauriClient.settings (persistent user preference).
 * Legacy global default is read once for migration only.
 */

import type { ResultAsync } from "neverthrow";

import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { AppError } from "../../errors/app-error.js";

export type WorktreeProjectDefaultsMap = Record<string, boolean>;

const PROJECT_DEFAULTS_KEY: UserSettingKey = "worktree_project_defaults";
const LEGACY_GLOBAL_DEFAULT_KEY: UserSettingKey = "worktree_global_default_enabled";

export function isWorktreeProjectDefaultsEmpty(map: WorktreeProjectDefaultsMap): boolean {
	for (const _key of Object.keys(map)) {
		return false;
	}
	return true;
}

export function getProjectWorktreeEnabled(
	projectPath: string,
	map: WorktreeProjectDefaultsMap
): boolean {
	const value = map[projectPath];
	return value === true;
}

export function setProjectWorktreeEnabled(
	projectPath: string,
	enabled: boolean,
	map: WorktreeProjectDefaultsMap
): WorktreeProjectDefaultsMap {
	const next: WorktreeProjectDefaultsMap = {};
	for (const key of Object.keys(map)) {
		if (key !== projectPath) {
			const existing = map[key];
			if (existing !== undefined) {
				next[key] = existing;
			}
		}
	}
	next[projectPath] = enabled;
	return next;
}

export function migrateWorktreeProjectDefaultsFromGlobal(
	map: WorktreeProjectDefaultsMap,
	legacyGlobalEnabled: boolean,
	projectPaths: readonly string[]
): WorktreeProjectDefaultsMap {
	if (!isWorktreeProjectDefaultsEmpty(map) || !legacyGlobalEnabled) {
		return map;
	}

	const next: WorktreeProjectDefaultsMap = {};
	for (const projectPath of projectPaths) {
		next[projectPath] = true;
	}
	return next;
}

export function loadWorktreeProjectDefaults(): ResultAsync<WorktreeProjectDefaultsMap, AppError> {
	return tauriClient.settings
		.get<WorktreeProjectDefaultsMap>(PROJECT_DEFAULTS_KEY)
		.map((value) => value ?? {});
}

export function saveWorktreeProjectDefaults(
	map: WorktreeProjectDefaultsMap
): ResultAsync<void, AppError> {
	return tauriClient.settings.set(PROJECT_DEFAULTS_KEY, map);
}

/** Legacy global default — read-only for one-time migration. */
export function loadWorktreeDefault(): ResultAsync<boolean, AppError> {
	return tauriClient.settings
		.get<boolean>(LEGACY_GLOBAL_DEFAULT_KEY)
		.map((value) => value ?? false);
}
