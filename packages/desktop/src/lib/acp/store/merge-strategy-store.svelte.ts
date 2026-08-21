/**
 * Merge Strategy Store - Persisted preference for the last-used PR merge strategy.
 * Defaults to "squash". Stored in user settings so it survives restarts.
 */

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { scheduleDeferredIdleWork } from "$lib/utils/deferred-work.js";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const SETTING_KEY: UserSettingKey = "git_merge_strategy_preference";
const DEFAULT: MergeStrategy = "squash";

class MergeStrategyStore {
	strategy = $state<MergeStrategy>(DEFAULT);

	private initialized = false;
	private initializeScheduled = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		this.initializeScheduled = false;

		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.get<MergeStrategy>(SETTING_KEY))
		);
		if (Result.isSuccess(result) && result.success) {
			this.strategy = result.success;
		}
	}

	scheduleInitialize(): void {
		if (this.initialized || this.initializeScheduled) {
			return;
		}
		this.initializeScheduled = true;
		scheduleDeferredIdleWork(() => {
			void this.initialize();
		});
	}

	async set(value: MergeStrategy): Promise<void> {
		this.strategy = value;
		void Effect.runPromise(
			tauriClient.settings.set(SETTING_KEY, value).pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: () => undefined,
				})
			)
		);
	}
}

export const mergeStrategyStore = new MergeStrategyStore();
