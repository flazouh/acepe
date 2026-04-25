/**
 * Attention Queue Store - Controls whether the attention queue panel is visible.
 *
 * The attention queue shows sessions needing user attention (questions, permissions, errors).
 * It is enabled by default — users opt out via Settings → General.
 */

import { getContext, setContext } from "svelte";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const SETTINGS_KEY: UserSettingKey = "attention_queue_enabled";
const STORE_KEY = Symbol("attention-queue-store");
const logger = createLogger({
	id: "attention-queue-store",
	name: "AttentionQueueStore",
});

export class AttentionQueueStore {
	enabled = $state(true);

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		const result = await tauriClient.settings.get<boolean>(SETTINGS_KEY);
		if (result.isOk() && result.value !== null) {
			this.enabled = result.value;
		}
	}

	async setEnabled(value: boolean): Promise<void> {
		this.enabled = value;
		tauriClient.settings.set(SETTINGS_KEY, value).mapErr((err) => {
			logger.error("Failed to persist attention queue setting", { error: err });
		});
	}
}

export function createAttentionQueueStore(): AttentionQueueStore {
	const store = new AttentionQueueStore();
	setContext(STORE_KEY, store);
	return store;
}

export function getAttentionQueueStore(): AttentionQueueStore {
	return getContext<AttentionQueueStore>(STORE_KEY);
}
