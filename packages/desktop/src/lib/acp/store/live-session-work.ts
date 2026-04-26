import type { SessionGraphActivity } from "../../services/acp-types.js";
import {
	type CanonicalSessionActivity,
	selectCanonicalSessionActivity,
} from "../logic/session-activity.js";
import type { SessionRuntimeState } from "../logic/session-ui-state.js";
import type { ToolCall } from "../types/tool-call.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import type { SessionOperationInteractionSnapshot } from "./operation-association.js";
import { deriveSessionState, type SessionState } from "./session-state.js";
import {
	deriveSessionWorkProjection,
	type SessionCompactActivityKind,
	type SessionWorkProjection,
} from "./session-work-projection.js";
import type { SessionTransientProjection } from "./types.js";

export interface LiveSessionWorkInput {
	readonly runtimeState: SessionRuntimeState | null;
	readonly hotState: Pick<
		SessionTransientProjection,
		"status" | "currentMode" | "connectionError" | "activeTurnFailure" | "activity"
	>;
	readonly canonicalProjection?: Pick<CanonicalSessionProjection, "lifecycle" | "activity"> | null;
	readonly currentStreamingToolCall: ToolCall | null;
	readonly interactionSnapshot: Pick<
		SessionOperationInteractionSnapshot,
		"pendingPlanApproval" | "pendingPermission" | "pendingQuestion"
	>;
	readonly hasUnseenCompletion: boolean;
}

type LiveConnectionState =
	| "disconnected"
	| "connecting"
	| "ready"
	| "awaitingResponse"
	| "streaming"
	| "paused"
	| "error";

function normalizeLifecycle(input: LiveSessionWorkInput): {
	connectionPhase: "disconnected" | "connecting" | "connected" | "failed";
	activityPhase: "idle" | "awaiting_model" | "running" | "paused";
} {
	if (input.canonicalProjection != null) {
		const lifecycle = input.canonicalProjection.lifecycle;
		const connectionPhase =
			lifecycle.status === "failed"
				? "failed"
				: lifecycle.status === "reserved" ||
						lifecycle.status === "detached" ||
						lifecycle.status === "archived"
					? "disconnected"
					: lifecycle.status === "activating" || lifecycle.status === "reconnecting"
						? "connecting"
						: "connected";
		const activityPhase =
			input.canonicalProjection.activity.kind === "paused"
				? "paused"
				: input.canonicalProjection.activity.kind === "awaiting_model" ||
						input.canonicalProjection.activity.kind === "waiting_for_user"
					? "awaiting_model"
					: input.canonicalProjection.activity.kind === "running_operation"
						? "running"
						: "idle";

		return {
			connectionPhase,
			activityPhase,
		};
	}

	if (input.runtimeState === null) {
		const hotStatus = input.hotState.status;
		if (hotStatus === "idle") {
			return {
				connectionPhase: "disconnected",
				activityPhase: "idle",
			};
		}
		if (hotStatus === "loading" || hotStatus === "connecting") {
			return {
				connectionPhase: "connecting",
				activityPhase: "idle",
			};
		}
		if (hotStatus === "streaming") {
			return {
				connectionPhase: "connected",
				activityPhase: "awaiting_model",
			};
		}
		if (hotStatus === "paused") {
			return {
				connectionPhase: "connected",
				activityPhase: "paused",
			};
		}
		if (hotStatus === "error") {
			return {
				connectionPhase: "failed",
				activityPhase: "idle",
			};
		}
		return {
			connectionPhase: "connected",
			activityPhase: "idle",
		};
	}

	if (input.hotState.status === "paused") {
		return {
			connectionPhase: input.runtimeState.connectionPhase,
			activityPhase: "paused",
		};
	}

	if (input.runtimeState.activityPhase === "running") {
		const activityPhase = input.runtimeState.showThinking ? "awaiting_model" : "running";
		return {
			connectionPhase: input.runtimeState.connectionPhase,
			activityPhase,
		};
	}

	if (input.runtimeState.activityPhase === "waiting_for_user") {
		return {
			connectionPhase: input.runtimeState.connectionPhase,
			activityPhase: "awaiting_model",
		};
	}

	return {
		connectionPhase: input.runtimeState.connectionPhase,
		activityPhase: "idle",
	};
}

function canonicalActivityFromGraphActivity(
	activity: SessionGraphActivity | null | undefined
): CanonicalSessionActivity | null {
	if (activity == null) {
		return null;
	}

	switch (activity.kind) {
		case "awaiting_model":
			return "awaiting_model";
		case "running_operation":
			return "running_operation";
		case "waiting_for_user":
			return "waiting_for_user";
		case "paused":
			return "paused";
		case "error":
			return "error";
		case "idle":
			return "idle";
	}
}

function fallbackCanonicalActivity(input: LiveSessionWorkInput): CanonicalSessionActivity {
	const lifecycle = normalizeLifecycle(input);

	return selectCanonicalSessionActivity({
		lifecycle,
		hasActiveOperation:
			lifecycle.activityPhase === "running" || input.currentStreamingToolCall !== null,
		hasPendingInput:
			input.interactionSnapshot.pendingPlanApproval !== null ||
			input.interactionSnapshot.pendingPermission !== null ||
			input.interactionSnapshot.pendingQuestion !== null,
		hasError:
			input.hotState.status === "error" ||
			input.hotState.connectionError !== null ||
			input.hotState.activeTurnFailure != null,
		hasUnseenCompletion: input.hasUnseenCompletion,
	});
}

function liveActivityOverride(input: LiveSessionWorkInput): CanonicalSessionActivity | null {
	if (
		input.hotState.status === "error" ||
		input.hotState.connectionError !== null ||
		input.hotState.activeTurnFailure != null
	) {
		return "error";
	}

	if (input.hotState.status === "paused") {
		return "paused";
	}

	if (
		input.interactionSnapshot.pendingPlanApproval !== null ||
		input.interactionSnapshot.pendingPermission !== null ||
		input.interactionSnapshot.pendingQuestion !== null
	) {
		return "waiting_for_user";
	}

	if (input.currentStreamingToolCall !== null) {
		return "running_operation";
	}

	if (input.hotState.status === "streaming") {
		return "awaiting_model";
	}

	if (input.runtimeState?.activityPhase === "running") {
		return input.runtimeState.showThinking ? "awaiting_model" : "running_operation";
	}

	if (input.runtimeState?.activityPhase === "waiting_for_user") {
		return "awaiting_model";
	}

	return null;
}

export function deriveLiveCanonicalActivity(input: LiveSessionWorkInput): CanonicalSessionActivity {
	const graphBackedActivity = canonicalActivityFromGraphActivity(
		input.canonicalProjection?.activity ?? input.hotState.activity ?? null
	);
	if (graphBackedActivity === "idle") {
		const overrideActivity = liveActivityOverride(input);
		if (overrideActivity !== null) {
			return overrideActivity;
		}
	}

	if (graphBackedActivity !== null) {
		return graphBackedActivity;
	}

	return fallbackCanonicalActivity(input);
}

function deriveLiveConnectionState(input: LiveSessionWorkInput): LiveConnectionState {
	const lifecycle = normalizeLifecycle(input);
	const canonicalActivity = deriveLiveCanonicalActivity(input);

	if (canonicalActivity === "error") {
		return "error";
	}

	if (lifecycle.connectionPhase === "connecting") {
		return "connecting";
	}

	if (lifecycle.connectionPhase === "disconnected") {
		return "disconnected";
	}

	if (canonicalActivity === "paused") {
		return "paused";
	}

	if (canonicalActivity === "running_operation") {
		return "streaming";
	}

	if (canonicalActivity === "awaiting_model" || canonicalActivity === "waiting_for_user") {
		return "awaitingResponse";
	}

	return "ready";
}

export function deriveLiveSessionState(input: LiveSessionWorkInput): SessionState {
	return deriveSessionState({
		connectionState: deriveLiveConnectionState(input),
		modeId: input.hotState.currentMode ? input.hotState.currentMode.id : null,
		tool: input.currentStreamingToolCall,
		pendingQuestion: input.interactionSnapshot.pendingQuestion,
		pendingPlanApproval: input.interactionSnapshot.pendingPlanApproval,
		pendingPermission: input.interactionSnapshot.pendingPermission,
		hasUnseenCompletion: input.hasUnseenCompletion,
	});
}

export function deriveLiveSessionWorkProjection(
	input: LiveSessionWorkInput
): SessionWorkProjection {
	const state = deriveLiveSessionState(input);
	const canonicalActivity = deriveLiveCanonicalActivity(input);
	return deriveSessionWorkProjection({
		state,
		currentModeId: input.hotState.currentMode ? input.hotState.currentMode.id : null,
		connectionError: input.hotState.connectionError,
		activeTurnFailure: input.hotState.activeTurnFailure ?? null,
		canonicalActivity,
	});
}

export function selectLiveCompactActivityKind(
	input: LiveSessionWorkInput
): SessionCompactActivityKind {
	return deriveLiveSessionWorkProjection(input).compactActivityKind;
}
