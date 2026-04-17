/**
 * Shared reactive store for the global worktree default.
 * Loads once from SQLite; all consumers read the same reactive value.
 */

import type { ResultAsync } from "neverthrow";

import { okAsync } from "neverthrow";

import type { AppError } from "../../errors/app-error.js";

import { loadWorktreeDefault, saveWorktreeDefault } from "./worktree-storage.js";

let instance: WorktreeDefaultStore | null = null;

/**
 * Store holding the global "use worktrees by default" preference.
 * Single source of truth; load once, then read reactively.
 */
export class WorktreeDefaultStore {
	globalDefault = $state(false);
	#loaded = false;

	/**
	 * Load from SQLite (no-op after first successful load).
	 */
	load(): ResultAsync<boolean, AppError> {
		if (this.#loaded) {
			return okAsync(this.globalDefault);
		}
		return loadWorktreeDefault().map((v) => {
			this.#loaded = true;
			this.globalDefault = v;
			return v;
		});
	}

	/**
	 * Save and update local state so all consumers see the new value.
	 */
	set(enabled: boolean): ResultAsync<void, AppError> {
		return saveWorktreeDefault(enabled).map(() => {
			this.globalDefault = enabled;
		});
	}
}

export function getWorktreeDefaultStore(): WorktreeDefaultStore {
	if (!instance) {
		instance = new WorktreeDefaultStore();
	}
	return instance;
}
