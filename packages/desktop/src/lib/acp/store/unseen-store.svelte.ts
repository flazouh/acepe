/**
 * Unseen Store - Tracks which panels have unseen agent completions.
 *
 * A panel is "unseen" when the agent finishes working (stream completes)
 * while the tab is not focused. The yellow dot clears when:
 * - The user clicks/focuses the tab
 * - The agent starts streaming again (spinner replaces dot)
 *
 * This is a UI-level concept separate from session lifecycle state.
 * It does NOT persist across app restarts.
 */

import { getContext, setContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";

const UNSEEN_STORE_KEY = Symbol("unseen-store");

export class UnseenStore {
	private readonly unseenPanels = new SvelteSet<string>();

	/** Mark a panel as having unseen content (agent completed while tab unfocused). */
	markUnseen(panelId: string): void {
		this.unseenPanels.add(panelId);
	}

	/** Clear unseen state (user focused the tab or agent started streaming). */
	markSeen(panelId: string): void {
		this.unseenPanels.delete(panelId);
	}

	/** Check if a panel has unseen content. */
	isUnseen(panelId: string): boolean {
		return this.unseenPanels.has(panelId);
	}

	/** Get count of unseen panels (useful for badges). */
	get count(): number {
		return this.unseenPanels.size;
	}
}

/**
 * Create and set the unseen store in Svelte context.
 */
export function createUnseenStore(): UnseenStore {
	const store = new UnseenStore();
	setContext(UNSEEN_STORE_KEY, store);
	return store;
}

/**
 * Get the unseen store from Svelte context.
 */
export function getUnseenStore(): UnseenStore {
	return getContext<UnseenStore>(UNSEEN_STORE_KEY);
}
