/**
 * Planning-indicator debug instrumentation (pull-based, dev-only).
 *
 * The agent panel's "Planning next moves…" placeholder is gated by
 * `showPlanningIndicator`, which is true when ANY of three conditions hold (see
 * session-status-mapper.ts:`deriveCanonicalAgentPanelSessionState`):
 *
 *   1. hasOptimisticPendingEntry   — a local optimistic user entry is pending
 *   2. hasLocalPendingSendIntent   — the transient pending-send-intent is set
 *   3. activity.kind === "awaiting_model" — canonical activity stuck awaiting model
 *
 * When a turn hangs on "Planning" (e.g. an empty/quota-exhausted Cursor turn),
 * we need to know WHICH of the three is stuck so the fix lands at the right
 * layer (canonical Rust vs transient TS). This module lets the controller
 * register a snapshot thunk that reads its live derived values on demand.
 *
 * Nothing is recorded eagerly: the thunk only runs when
 * `window.__acepePlanningSnapshot()` is invoked from the dev WebView (QA CLI).
 * No `$effect`, no writes inside `$derived`. Registration is keyed by the
 * controller instance, so re-registration overwrites and the footprint is
 * bounded by the number of live panel controllers.
 */

export interface PlanningDebugSnapshot {
	readonly sessionId: string | null;
	readonly sourceKind: string | null;
	readonly lifecycleStatus: string | null;
	readonly activityKind: string | null;
	readonly turnState: string | null;
	readonly hasOptimisticPendingEntry: boolean;
	readonly hasLocalPendingSendIntent: boolean;
	readonly pendingSendIntentAttemptId: string | null;
	readonly hasMessages: boolean;
	readonly visibleEntryCount: number;
	readonly showPlanningIndicator: boolean;
	readonly capturedAtMs: number;
}

type SnapshotThunk = () => PlanningDebugSnapshot;

const sources = new Map<object, SnapshotThunk>();

function snapshotAll(sessionId: string | null): readonly PlanningDebugSnapshot[] {
	const all = Array.from(sources.values(), (thunk) => thunk());
	if (sessionId === null) {
		return all;
	}
	return all.filter((snapshot) => snapshot.sessionId === sessionId);
}

function installGlobal(): void {
	const host = globalThis as unknown as {
		__acepePlanningSnapshot?: (sessionId?: string | null) => readonly PlanningDebugSnapshot[];
	};
	if (host.__acepePlanningSnapshot !== undefined) {
		return;
	}
	host.__acepePlanningSnapshot = (sessionId?: string | null) =>
		snapshotAll(sessionId ?? null);
}

/**
 * Register a controller's snapshot thunk. Keyed by the controller instance so a
 * given controller has at most one entry. Installs the `window` reader lazily on
 * first registration.
 */
export function registerPlanningDebugSource(key: object, thunk: SnapshotThunk): void {
	sources.set(key, thunk);
	installGlobal();
}

/** Drop a controller's thunk (call on teardown to keep the registry bounded). */
export function unregisterPlanningDebugSource(key: object): void {
	sources.delete(key);
}
