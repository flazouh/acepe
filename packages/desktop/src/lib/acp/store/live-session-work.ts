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

export interface LiveSessionWorkInput {
	readonly runtimeState: SessionRuntimeState | null;
	readonly canonicalProjection?: Pick<
		CanonicalSessionProjection,
		"lifecycle" | "activity" | "activeTurnFailure"
	> | null;
	readonly currentModeId: string | null;
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
	const canonical = input.canonicalProjection;
	if (canonical == null) {
		return {
			connectionPhase: "disconnected",
			activityPhase: "idle",
		};
	}

	const lifecycle = canonical.lifecycle;
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
		canonical.activity.kind === "paused"
			? "paused"
			: canonical.activity.kind === "awaiting_model" ||
					canonical.activity.kind === "waiting_for_user"
				? "awaiting_model"
				: canonical.activity.kind === "running_operation"
					? "running"
					: "idle";

	return {
		connectionPhase,
		activityPhase,
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
	const canonical = input.canonicalProjection;
	if (canonical == null) {
		return "idle";
	}

	const lifecycle = normalizeLifecycle(input);

	const canonicalHasFailure =
		canonical.activeTurnFailure != null ||
		canonical.lifecycle.status === "failed" ||
		canonical.lifecycle.errorMessage != null;

	return selectCanonicalSessionActivity({
		lifecycle,
		hasActiveOperation:
			lifecycle.activityPhase === "running" || input.currentStreamingToolCall !== null,
		hasPendingInput:
			input.interactionSnapshot.pendingPlanApproval !== null ||
			input.interactionSnapshot.pendingPermission !== null ||
			input.interactionSnapshot.pendingQuestion !== null,
		hasError: canonicalHasFailure,
		hasUnseenCompletion: input.hasUnseenCompletion,
	});
}

function liveActivityOverride(input: LiveSessionWorkInput): CanonicalSessionActivity | null {
	const canonical = input.canonicalProjection;
	if (canonical == null) {
		return null;
	}

	const errorActive =
		canonical.activeTurnFailure != null ||
		canonical.lifecycle.status === "failed" ||
		canonical.lifecycle.errorMessage != null;

	if (errorActive) {
		return "error";
	}

	if (canonical.activity.kind === "paused") {
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
		input.canonicalProjection?.activity ?? null
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

	if (canonicalActivity === "paused") {
		return "paused";
	}

	if (canonicalActivity === "running_operation") {
		return "streaming";
	}

	if (canonicalActivity === "awaiting_model" || canonicalActivity === "waiting_for_user") {
		return "awaitingResponse";
	}

	if (lifecycle.connectionPhase === "disconnected") {
		return "disconnected";
	}

	return "ready";
}

export function deriveLiveSessionState(input: LiveSessionWorkInput): SessionState {
	return deriveSessionState({
		connectionState: deriveLiveConnectionState(input),
		modeId: input.currentModeId,
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
	const canonical = input.canonicalProjection;
	const connectionError = canonical?.lifecycle.errorMessage ?? null;
	const activeTurnFailure = canonical?.activeTurnFailure ?? null;
	return deriveSessionWorkProjection({
		state,
		currentModeId: input.currentModeId,
		connectionError,
		activeTurnFailure,
		canonicalActivity,
	});
}

export function selectLiveCompactActivityKind(
	input: LiveSessionWorkInput
): SessionCompactActivityKind {
	return deriveLiveSessionWorkProjection(input).compactActivityKind;
}
