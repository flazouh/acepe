export type CanonicalSessionActivity =
	| "awaiting_model"
	| "running_operation"
	| "waiting_for_user"
	| "paused"
	| "error"
	| "idle";

export type CanonicalSessionLifecycleActivityPhase =
	| "idle"
	| "awaiting_model"
	| "running"
	| "paused";

export interface CanonicalSessionActivityInput {
	readonly lifecycle: {
		readonly connectionPhase: "disconnected" | "connecting" | "connected" | "failed";
		readonly activityPhase: CanonicalSessionLifecycleActivityPhase;
	};
	readonly hasActiveOperation: boolean;
	readonly hasPendingInput: boolean;
	readonly hasError: boolean;
	readonly hasUnseenCompletion: boolean;
}

export function selectCanonicalSessionActivity(
	input: CanonicalSessionActivityInput
): CanonicalSessionActivity {
	if (input.hasError || input.lifecycle.connectionPhase === "failed") {
		return "error";
	}

	if (input.lifecycle.activityPhase === "paused") {
		return "paused";
	}

	if (input.hasPendingInput) {
		return "waiting_for_user";
	}

	if (input.hasActiveOperation) {
		return "running_operation";
	}

	if (input.lifecycle.activityPhase === "awaiting_model") {
		return "awaiting_model";
	}

	return "idle";
}
