/**
 * Plan information.
 *
 * Represents a plan created by the assistant for completing a task.
 */
export type Plan = {
	/**
	 * Steps in the plan.
	 */
	steps: PlanStep[];

	/**
	 * Current step index (if plan is in progress).
	 */
	currentStep?: number;
};

/**
 * A single step in a plan.
 */
export type PlanStep = {
	/**
	 * Description of the step.
	 */
	description: string;

	/**
	 * Status of the step.
	 */
	status: "pending" | "in_progress" | "completed" | "failed";
};

// SessionPlan for Claude Code plan mode is defined in converted-session-types.ts
// as SessionPlanResponse (auto-generated from Rust backend via specta)
