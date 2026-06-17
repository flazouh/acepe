/**
 * Session Transient Projection Store - manages non-authoritative frontend
 * projections for local UI affordances and telemetry.
 *
 * Uses SvelteMap for fine-grained per-session reactivity: when session A's
 * transient projection changes, only components reading session A re-render.
 */

import { SvelteMap } from "svelte/reactivity";

import type { ITransientProjectionManager } from "./services/interfaces/index.js";
import type { SessionPendingSendIntent, SessionTransientProjection, SessionUsageTelemetry } from "./types.js";

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
	getTransientProjection(sessionId: string): SessionTransientProjection {
		return this.transientProjections.get(sessionId) ?? DEFAULT_TRANSIENT_PROJECTION;
	}

	/**
	 * Check if a session has a transient projection.
	 */
	hasTransientProjection(sessionId: string): boolean {
		return this.transientProjections.has(sessionId);
	}

	/**
	 * Update transient projection state for a session.
	 * Writes directly to SvelteMap for fine-grained reactivity.
	 */
	updateTransientProjection(sessionId: string, updates: Partial<SessionTransientProjection>): void {
		const current = this.transientProjections.get(sessionId) ?? DEFAULT_TRANSIENT_PROJECTION;
		let hasChange = false;
		for (const key of Object.keys(updates) as Array<keyof SessionTransientProjection>) {
			if (current[key] !== updates[key]) {
				hasChange = true;
				break;
			}
		}
		if (!hasChange) {
			return;
		}

		// Write directly to SvelteMap (fine-grained reactivity)
		this.transientProjections.set(sessionId, Object.assign({}, current, updates));
	}

	/**
	 * Remove transient projection state for a session.
	 * SvelteMap: .delete() triggers fine-grained reactivity for this session only.
	 */
	removeTransientProjection(sessionId: string): void {
		// SvelteMap: fine-grained deletion, only this session's subscribers re-render
		this.transientProjections.delete(sessionId);
	}

	/**
	 * Initialize transient projection state for a session with default values.
	 * Only initializes if session doesn't already have a transient projection.
	 * SvelteMap: .set() triggers fine-grained reactivity for this session only.
	 */
	initializeTransientProjection(sessionId: string, initialState?: Partial<SessionTransientProjection>): void {
		if (!this.transientProjections.has(sessionId)) {
			// SvelteMap: fine-grained addition, only this session's subscribers re-render
			this.transientProjections.set(
				sessionId,
				Object.assign({}, DEFAULT_TRANSIENT_PROJECTION, initialState)
			);
		}
	}

	getSessionPendingSendIntent(sessionId: string): SessionPendingSendIntent | null {
		return this.getTransientProjection(sessionId).pendingSendIntent ?? null;
	}

	getSessionHasLocalPendingSendIntent(sessionId: string): boolean {
		return this.getSessionPendingSendIntent(sessionId) !== null;
	}

	getSessionAcpSessionId(sessionId: string): string | null {
		return this.getTransientProjection(sessionId).acpSessionId;
	}

	getSessionUsageTelemetry(sessionId: string): SessionUsageTelemetry | null {
		return this.getTransientProjection(sessionId).usageTelemetry ?? null;
	}

	getSessionAutonomousTransitionBusy(sessionId: string): boolean {
		return this.getTransientProjection(sessionId).autonomousTransition !== "idle";
	}

	getSessionStatusChangedAt(sessionId: string): number {
		return this.getTransientProjection(sessionId).statusChangedAt;
	}
}
