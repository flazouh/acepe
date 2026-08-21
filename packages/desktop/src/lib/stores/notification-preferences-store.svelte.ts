/**
 * Notification Preferences Store - Per-category toggles for popup notifications.
 *
 * Controls whether popup notification windows appear for:
 * - Questions & permissions (agent needs input)
 * - Task completions (agent finished work)
 *
 * Follows the ReviewPreferenceStore pattern: persisted via tauriClient.settings.
 */

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { getContext, setContext } from "svelte";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const SETTINGS_KEY: UserSettingKey = "notification-preferences";
const STORE_KEY = Symbol("notification-preferences");
const logger = createLogger({
	id: "notification-preferences",
	name: "NotificationPreferencesStore",
});

interface PersistedPreferences {
	questionsEnabled: boolean;
	completionsEnabled: boolean;
}

const DEFAULTS: PersistedPreferences = {
	questionsEnabled: true,
	completionsEnabled: true,
};

export class NotificationPreferencesStore {
	questionsEnabled = $state(true);
	completionsEnabled = $state(true);

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.get<PersistedPreferences>(SETTINGS_KEY))
		);
		if (Result.isSuccess(result) && result.success) {
			this.questionsEnabled =
				result.success.questionsEnabled === undefined
					? DEFAULTS.questionsEnabled
					: result.success.questionsEnabled;
			this.completionsEnabled =
				result.success.completionsEnabled === undefined
					? DEFAULTS.completionsEnabled
					: result.success.completionsEnabled;
		}
	}

	async setQuestionsEnabled(value: boolean): Promise<void> {
		this.questionsEnabled = value;
		this.persist();
	}

	async setCompletionsEnabled(value: boolean): Promise<void> {
		this.completionsEnabled = value;
		this.persist();
	}

	private persist(): void {
		const prefs: PersistedPreferences = {
			questionsEnabled: this.questionsEnabled,
			completionsEnabled: this.completionsEnabled,
		};
		void Effect.runPromise(
			tauriClient.settings.set(SETTINGS_KEY, prefs).pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: (err) => {
						logger.error("Failed to persist notification preferences", { error: err });
					},
				})
			)
		);
	}
}

export function createNotificationPreferencesStore(): NotificationPreferencesStore {
	const store = new NotificationPreferencesStore();
	setContext(STORE_KEY, store);
	return store;
}

export function getNotificationPreferencesStore(): NotificationPreferencesStore {
	return getContext<NotificationPreferencesStore>(STORE_KEY);
}
