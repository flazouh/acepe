/**
 * Review Preference Store - Persisted preference for review view mode.
 *
 * When "prefer fullscreen" is true, clicking Review opens the full-screen overlay.
 * When false, Review opens the inline panel review.
 */

import { getContext, setContext } from "svelte";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const REVIEW_PREFER_FULLSCREEN_KEY: UserSettingKey = "review_prefer_fullscreen";

const STORE_KEY = Symbol("review-preference-store");

export class ReviewPreferenceStore {
	preferFullscreen = $state(false);

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		const result = await tauriClient.settings.get<boolean>(REVIEW_PREFER_FULLSCREEN_KEY);
		if (result.isOk() && result.value === true) {
			this.preferFullscreen = true;
		}
	}

	async setPreferFullscreen(value: boolean): Promise<void> {
		this.preferFullscreen = value;
		tauriClient.settings.set(REVIEW_PREFER_FULLSCREEN_KEY, value).mapErr(() => {});
	}
}

export function createReviewPreferenceStore(): ReviewPreferenceStore {
	const store = new ReviewPreferenceStore();
	setContext(STORE_KEY, store);
	return store;
}

export function getReviewPreferenceStore(): ReviewPreferenceStore {
	return getContext<ReviewPreferenceStore>(STORE_KEY);
}
