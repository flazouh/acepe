import { getPlanStore } from "../../../store/plan-store.svelte.js";
import type { PlanState, SessionIdentityForPlan } from "../types";

/**
 * Hook for loading session plans.
 *
 * Reads plan data from the PlanStore. For initial loads (when no plan is in store),
 * triggers a load from disk. Real-time updates come via ACP events which update the store.
 *
 * @param sessionIdentity - Session identity getter (id, projectPath, agentId)
 * @returns Plan state with plan, loading status, and errors
 *
 * @example
 * ```ts
 * const planState = usePlanLoader(() => ({
 *   id: sessionId,
 *   projectPath: sessionProjectPath,
 *   agentId: sessionAgentId,
 * }));
 *
 * $inspect(planState.plan); // Access loaded plan
 * ```
 */
export function usePlanLoader(sessionIdentity: () => SessionIdentityForPlan | null): PlanState {
	const planStore = getPlanStore();

	// Track last session key to detect session changes and trigger initial load
	let lastSessionKey = "";

	// Trigger initial load when session changes
	$effect(() => {
		const identity = sessionIdentity();

		if (!identity?.id || !identity?.projectPath || !identity?.agentId) {
			lastSessionKey = "";
			return;
		}

		const sessionKey = `${identity.id}:${identity.projectPath}:${identity.agentId}`;

		// Only trigger initial load on session change
		if (sessionKey === lastSessionKey) {
			return;
		}

		lastSessionKey = sessionKey;

		// If plan not yet in store for this session, trigger initial load
		if (planStore.plans.get(identity.id) === undefined) {
			planStore.loadPlan(identity.id, identity.projectPath, identity.agentId);
		}
	});

	// Derive plan from store (reactive - updates when store changes)
	const plan = $derived.by(() => {
		const identity = sessionIdentity();
		if (!identity?.id) return null;
		return planStore.plans.get(identity.id) ?? null;
	});

	// Derive loading state from store
	const loading = $derived.by(() => {
		const identity = sessionIdentity();
		if (!identity?.id) return false;
		return planStore.isLoading(identity.id);
	});

	return {
		get plan() {
			return plan;
		},
		get loading() {
			return loading;
		},
		get error() {
			// Error handling is done in PlanStore, null plan means no plan or error
			return null;
		},
	};
}
