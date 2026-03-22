/**
 * Notification Preferences Store - Per-category toggles for popup notifications.
 *
 * Controls whether popup notification windows appear for:
 * - Questions & permissions (agent needs input)
 * - Task completions (agent finished work)
 *
 * Follows the ReviewPreferenceStore pattern: persisted via tauriClient.settings.
 */

import { getContext, setContext } from "svelte";
import { createLogger } from "$lib/acp/utils/logger.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";

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

		const result = await tauriClient.settings.get<PersistedPreferences>(SETTINGS_KEY);
		if (result.isOk() && result.value) {
			this.questionsEnabled = result.value.questionsEnabled ?? DEFAULTS.questionsEnabled;
			this.completionsEnabled = result.value.completionsEnabled ?? DEFAULTS.completionsEnabled;
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
		tauriClient.settings.set(SETTINGS_KEY, prefs).mapErr((err) => {
			logger.error("Failed to persist notification preferences", { error: err });
		});
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
