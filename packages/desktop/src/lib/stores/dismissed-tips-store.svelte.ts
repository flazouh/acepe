import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { getContext, setContext } from "svelte";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const SETTINGS_KEY: UserSettingKey = "dismissed_tooltips";
const STORE_KEY = Symbol("dismissed-tips");
const logger = createLogger({
	id: "dismissed-tips",
	name: "DismissedTipsStore",
});

export class DismissedTipsStore {
	dismissedKeys = $state(new Set<string>());

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		this.initialized = true;

		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.get<string[]>(SETTINGS_KEY))
		);
		if (Result.isSuccess(result)) {
			const keys = result.success ?? [];
			this.dismissedKeys = new Set(keys);
			return;
		}

		logger.warn("Failed to load dismissed tips", { error: result.failure });
	}

	isDismissed(key: string): boolean {
		return this.dismissedKeys.has(key);
	}

	dismiss(key: string): void {
		if (this.dismissedKeys.has(key)) {
			return;
		}

		const next = new Set(this.dismissedKeys);
		next.add(key);
		this.dismissedKeys = next;
		this.persist();
	}

	private persist(): void {
		const nextKeys = Array.from(this.dismissedKeys);
		void Effect.runPromise(
			tauriClient.settings.set(SETTINGS_KEY, nextKeys).pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: (err) => {
						logger.error("Failed to persist dismissed tips", { error: err });
					},
				})
			)
		);
	}
}

export function createDismissedTipsStore(): DismissedTipsStore {
	const store = new DismissedTipsStore();
	setContext(STORE_KEY, store);
	return store;
}

export function getDismissedTipsStore(): DismissedTipsStore {
	return getContext<DismissedTipsStore>(STORE_KEY);
}
