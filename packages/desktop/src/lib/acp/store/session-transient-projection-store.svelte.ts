/**
 * Session Transient Projection Store - manages non-authoritative frontend
 * projections for local UI affordances and telemetry.
 *
 * Uses SvelteMap for fine-grained per-session reactivity: when session A's
 * transient projection changes, only components reading session A re-render.
 */

import { SvelteMap } from "svelte/reactivity";

import type { ITransientProjectionManager } from "./services/interfaces/index.js";
import type { SessionTransientProjection } from "./types.js";

import { DEFAULT_TRANSIENT_PROJECTION } from "./types.js";

/**
 * Store for managing session transient projections with direct writes.
 * Implements ITransientProjectionManager interface for use by extracted services.
 *
 * Uses SvelteMap for fine-grained reactivity - only components reading
 * a specific session's projection re-render when that session changes.
 */
export class SessionTransientProjectionStore implements ITransientProjectionManager {
	// Primary transient projection storage with fine-grained per-session reactivity
	// SvelteMap provides fine-grained reactivity without needing $state wrapper
	private transientProjections = new SvelteMap<string, SessionTransientProjection>();

	/**
	 * Get the transient projection for a session.
	 */
	getHotState(sessionId: string): SessionTransientProjection {
		return this.transientProjections.get(sessionId) ?? DEFAULT_TRANSIENT_PROJECTION;
	}

	/**
	 * Check if a session has a transient projection.
	 */
	hasHotState(sessionId: string): boolean {
		return this.transientProjections.has(sessionId);
	}

	/**
	 * Update transient projection state for a session.
	 * Writes directly to SvelteMap for fine-grained reactivity.
	 */
	updateHotState(sessionId: string, updates: Partial<SessionTransientProjection>): void {
		const current = this.transientProjections.get(sessionId) ?? DEFAULT_TRANSIENT_PROJECTION;
		// Write directly to SvelteMap (fine-grained reactivity)
		this.transientProjections.set(sessionId, Object.assign({}, current, updates));
	}

	/**
	 * Remove transient projection state for a session.
	 * SvelteMap: .delete() triggers fine-grained reactivity for this session only.
	 */
	removeHotState(sessionId: string): void {
		// SvelteMap: fine-grained deletion, only this session's subscribers re-render
		this.transientProjections.delete(sessionId);
	}

	/**
	 * Initialize transient projection state for a session with default values.
	 * Only initializes if session doesn't already have a transient projection.
	 * SvelteMap: .set() triggers fine-grained reactivity for this session only.
	 */
	initializeHotState(sessionId: string, initialState?: Partial<SessionTransientProjection>): void {
		if (!this.transientProjections.has(sessionId)) {
			// SvelteMap: fine-grained addition, only this session's subscribers re-render
			this.transientProjections.set(
				sessionId,
				Object.assign({}, DEFAULT_TRANSIENT_PROJECTION, initialState)
			);
		}
	}
}
