/**
 * Shared reactive store for per-project worktree defaults.
 * Loads once from SQLite; all consumers read the same reactive map.
 */

import type { ResultAsync } from "neverthrow";

import { okAsync } from "neverthrow";

import type { AppError } from "../../errors/app-error.js";

import {
	getProjectWorktreeEnabled,
	isWorktreeProjectDefaultsEmpty,
	loadWorktreeDefault,
	loadWorktreeProjectDefaults,
	migrateWorktreeProjectDefaultsFromGlobal,
	saveWorktreeProjectDefaults,
	setProjectWorktreeEnabled,
	type WorktreeProjectDefaultsMap,
} from "./worktree-storage.js";

let instance: WorktreeProjectDefaultStore | null = null;

export interface WorktreeProjectDefaultStoreLoadOptions {
	readonly getProjectPaths: () => readonly string[];
}

/**
 * Store holding per-project "use worktree for new sessions" preferences.
 * Single source of truth; load once, then read reactively.
 */
export class WorktreeProjectDefaultStore {
	#defaults = $state<WorktreeProjectDefaultsMap>({});
	#loaded = false;

	get defaults(): WorktreeProjectDefaultsMap {
		return this.#defaults;
	}

	/**
	 * Load from SQLite (no-op after first successful load).
	 * Migrates legacy global default to per-project map when needed.
	 */
	load(options: WorktreeProjectDefaultStoreLoadOptions): ResultAsync<void, AppError> {
		if (this.#loaded) {
			return okAsync(undefined);
		}

		return loadWorktreeProjectDefaults().andThen((loadedMap) =>
			loadWorktreeDefault().andThen((legacyGlobalEnabled) => {
				const migratedMap = migrateWorktreeProjectDefaultsFromGlobal(
					loadedMap,
					legacyGlobalEnabled,
					options.getProjectPaths()
				);

				const needsSave =
					isWorktreeProjectDefaultsEmpty(loadedMap) && !isWorktreeProjectDefaultsEmpty(migratedMap);

				if (needsSave) {
					return saveWorktreeProjectDefaults(migratedMap).map(() => {
						this.#loaded = true;
						this.#defaults = migratedMap;
					});
				}

				this.#loaded = true;
				this.#defaults = migratedMap;
				return okAsync(undefined);
			})
		);
	}

	isEnabled(projectPath: string | null | undefined): boolean {
		if (!projectPath) {
			return false;
		}
		return getProjectWorktreeEnabled(projectPath, this.#defaults);
	}

	/**
	 * Save and update local state so all consumers see the new value.
	 */
	set(projectPath: string, enabled: boolean): ResultAsync<void, AppError> {
		const next = setProjectWorktreeEnabled(projectPath, enabled, this.#defaults);
		return saveWorktreeProjectDefaults(next).map(() => {
			this.#defaults = next;
		});
	}
}

export function getWorktreeProjectDefaultStore(): WorktreeProjectDefaultStore {
	if (!instance) {
		instance = new WorktreeProjectDefaultStore();
	}
	return instance;
}
