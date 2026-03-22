/**
 * Session Hot State Store - Manages transient session state.
 *
 * Handles frequently-changing state (isStreaming, isConnected, status, etc.)
 * separately from cold session data for performance optimization.
 *
 * Uses SvelteMap for fine-grained per-session reactivity: when session A's
 * hot state changes, only components reading session A re-render.
 */

import { SvelteMap } from "svelte/reactivity";

import type { IHotStateManager } from "./services/interfaces/index.js";
import type { SessionHotState } from "./types.js";

import { DEFAULT_HOT_STATE } from "./types.js";

/**
 * Store for managing session hot state with direct writes.
 * Implements IHotStateManager interface for use by extracted services.
 *
 * Uses SvelteMap for fine-grained reactivity - only components reading
 * a specific session's hot state re-render when that session changes.
 */
export class SessionHotStateStore implements IHotStateManager {
	// Primary hot state storage with fine-grained per-session reactivity
	// SvelteMap provides fine-grained reactivity without needing $state wrapper
	private hotState = new SvelteMap<string, SessionHotState>();

	/**
	 * Get hot state for a session.
	 * Returns default hot state if session has no hot state.
	 */
	getHotState(sessionId: string): SessionHotState {
		return this.hotState.get(sessionId) ?? DEFAULT_HOT_STATE;
	}

	/**
	 * Check if a session has hot state.
	 */
	hasHotState(sessionId: string): boolean {
		return this.hotState.has(sessionId);
	}

	/**
	 * Update hot state for a session.
	 * Writes directly to SvelteMap for fine-grained reactivity.
	 *
	 * Automatically tracks statusChangedAt when status changes.
	 */
	updateHotState(sessionId: string, updates: Partial<SessionHotState>): void {
		// Track status change timestamp
		const current = this.hotState.get(sessionId) ?? DEFAULT_HOT_STATE;
		if (updates.status !== undefined && updates.status !== current.status) {
			updates = { ...updates, statusChangedAt: Date.now() };
		}

		// Write directly to SvelteMap (fine-grained reactivity)
		this.hotState.set(sessionId, { ...current, ...updates });
	}

	/**
	 * Remove hot state for a session.
	 * SvelteMap: .delete() triggers fine-grained reactivity for this session only.
	 */
	removeHotState(sessionId: string): void {
		// SvelteMap: fine-grained deletion, only this session's subscribers re-render
		this.hotState.delete(sessionId);
	}

	/**
	 * Initialize hot state for a session with default values.
	 * Only initializes if session doesn't already have hot state.
	 * SvelteMap: .set() triggers fine-grained reactivity for this session only.
	 */
	initializeHotState(sessionId: string, initialState?: Partial<SessionHotState>): void {
		if (!this.hotState.has(sessionId)) {
			// SvelteMap: fine-grained addition, only this session's subscribers re-render
			this.hotState.set(sessionId, { ...DEFAULT_HOT_STATE, ...initialState });
		}
	}
}
