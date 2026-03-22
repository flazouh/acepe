import type { SessionPlanResponse } from "../../../../services/claude-history";

/**
 * State for session plan loading.
 *
 * Tracks the current plan, loading status, and errors.
 */
export interface PlanState {
	/**
	 * The loaded plan, or null if no plan exists or loading failed.
	 */
	readonly plan: SessionPlanResponse | null;

	/**
	 * Whether a plan is currently being loaded.
	 */
	readonly loading: boolean;

	/**
	 * Error that occurred during plan loading, if any.
	 */
	readonly error: Error | null;
}
