/**
 * Shared reactive store for per-project worktree defaults.
 * Loads once from SQLite; all consumers read the same reactive map.
 */

import * as Effect from "effect/Effect";

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
	load(options: WorktreeProjectDefaultStoreLoadOptions): Effect.Effect<void, AppError> {
		if (this.#loaded) {
			return Effect.succeed(undefined);
		}

		return loadWorktreeProjectDefaults().pipe(
			Effect.flatMap((loadedMap) =>
				loadWorktreeDefault().pipe(
					Effect.flatMap((legacyGlobalEnabled) => {
						const migratedMap = migrateWorktreeProjectDefaultsFromGlobal(
							loadedMap,
							legacyGlobalEnabled,
							options.getProjectPaths()
						);

						const needsSave =
							isWorktreeProjectDefaultsEmpty(loadedMap) &&
							!isWorktreeProjectDefaultsEmpty(migratedMap);

						if (needsSave) {
							return saveWorktreeProjectDefaults(migratedMap).pipe(
								Effect.map(() => {
									this.#loaded = true;
									this.#defaults = migratedMap;
								})
							);
						}

						this.#loaded = true;
						this.#defaults = migratedMap;
						return Effect.succeed(undefined);
					})
				)
			)
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
	set(projectPath: string, enabled: boolean): Effect.Effect<void, AppError> {
		const next = setProjectWorktreeEnabled(projectPath, enabled, this.#defaults);
		return saveWorktreeProjectDefaults(next).pipe(
			Effect.map(() => {
				this.#defaults = next;
			})
		);
	}
}

export function getWorktreeProjectDefaultStore(): WorktreeProjectDefaultStore {
	if (!instance) {
		instance = new WorktreeProjectDefaultStore();
	}
	return instance;
}
