import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { getContext, setContext } from "svelte";
import { createLogger } from "$lib/acp/utils/logger.js";
import { setAnalyticsEnabled } from "$lib/analytics.js";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const SETTINGS_KEY: UserSettingKey = "analytics_opt_out";
const STORE_KEY = Symbol("analytics-preferences-store");
const logger = createLogger({
	id: "analytics-preferences",
	name: "AnalyticsPreferencesStore",
});

export class AnalyticsPreferencesStore {
	enabled = $state(true);

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.get<boolean>(SETTINGS_KEY))
		);
		if (Result.isSuccess(result) && result.success !== null) {
			this.enabled = !result.success;
		}
	}

	async setEnabled(value: boolean): Promise<void> {
		const previous = this.enabled;
		this.enabled = value;

		const persistResult = await Effect.runPromise(
			Effect.result(tauriClient.settings.set(SETTINGS_KEY, !value))
		);
		if (Result.isFailure(persistResult)) {
			this.enabled = previous;
			logger.error("Failed to persist analytics preference", { error: persistResult.failure });
			return;
		}

		await setAnalyticsEnabled(value);
	}
}

export function createAnalyticsPreferencesStore(): AnalyticsPreferencesStore {
	const store = new AnalyticsPreferencesStore();
	setContext(STORE_KEY, store);
	return store;
}

export function getAnalyticsPreferencesStore(): AnalyticsPreferencesStore {
	return getContext<AnalyticsPreferencesStore>(STORE_KEY);
}
