/**
 * Merge Strategy Store - Persisted preference for the last-used PR merge strategy.
 * Defaults to "squash". Stored in user settings so it survives restarts.
 */

import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const SETTING_KEY: UserSettingKey = "git_merge_strategy_preference";
const DEFAULT: MergeStrategy = "squash";

class MergeStrategyStore {
	strategy = $state<MergeStrategy>(DEFAULT);

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		const result = await tauriClient.settings.get<MergeStrategy>(SETTING_KEY);
		if (result.isOk() && result.value) {
			this.strategy = result.value;
		}
	}

	async set(value: MergeStrategy): Promise<void> {
		this.strategy = value;
		tauriClient.settings.set(SETTING_KEY, value).mapErr(() => {});
	}
}

export const mergeStrategyStore = new MergeStrategyStore();
