/**
 * Plan Preference Store - Persisted preference for plan display mode.
 *
 * When "prefer inline" is true (default), plans render inside chat tool cards.
 * When false, plans open in the sidebar panel (current/legacy behavior).
 */

import { getContext, setContext } from "svelte";
import { tauriClient } from "$lib/utils/tauri-client.js";

import { createLogger } from "../utils/logger.js";

const logger = createLogger("plan-preference-store");

const PLAN_INLINE_MODE_KEY = "plan_inline_mode";

const STORE_KEY = Symbol("plan-preference-store");

export class PlanPreferenceStore {
	preferInline = $state(true);
	isReady = $state(false);

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		const result =
			await tauriClient.settings.get<boolean>(PLAN_INLINE_MODE_KEY);
		if (result.isOk() && result.value === false) {
			this.preferInline = false;
		}
		this.isReady = true;
	}

	async setPreferInline(value: boolean): Promise<void> {
		this.preferInline = value;
		tauriClient.settings.set(PLAN_INLINE_MODE_KEY, value).mapErr((err) => {
			logger.warn("Failed to persist plan preference", { error: err });
		});
	}
}

export function createPlanPreferenceStore(): PlanPreferenceStore {
	const store = new PlanPreferenceStore();
	setContext(STORE_KEY, store);
	return store;
}

export function getPlanPreferenceStore(): PlanPreferenceStore {
	return getContext<PlanPreferenceStore>(STORE_KEY);
}
