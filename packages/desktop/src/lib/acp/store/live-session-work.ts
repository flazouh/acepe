import type { SessionGraphActivity } from "../../services/acp-types.js";
import type { CanonicalSessionActivity } from "../logic/session-activity.js";
import type {
	ActivityPhase,
	ConnectionPhase,
	ContentPhase,
} from "../logic/session-ui-state.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import type { SessionOperationInteractionSnapshot } from "./operation-association.js";
import { deriveSessionState, type SessionState } from "./session-state.js";
import {
	deriveSessionWorkProjection,
	type SessionCompactActivityKind,
	type SessionWorkProjection,
} from "./session-work-projection.js";

export interface LiveSessionWorkInput {
	readonly canonicalProjection?: Pick<
		CanonicalSessionProjection,
		"lifecycle" | "activity" | "activeTurnFailure"
	> | null;
	readonly currentModeId: string | null;
	readonly interactionSnapshot: Pick<
		SessionOperationInteractionSnapshot,
		"pendingPlanApproval" | "pendingPermission" | "pendingQuestion"
	>;
	readonly hasUnseenCompletion: boolean;
}

export interface LiveSessionLifecyclePresentationInput {
	readonly canonicalProjection?: Pick<
		CanonicalSessionProjection,
		"lifecycle" | "activity" | "activeTurnFailure"
	> | null;
	readonly hasEntries: boolean;
	readonly hasLocalPendingSendIntent: boolean;
}

export interface LiveSessionLifecyclePresentation {
	readonly connectionPhase: ConnectionPhase;
	readonly contentPhase: ContentPhase;
	readonly activityPhase: ActivityPhase;
	readonly canSubmit: boolean;
	readonly canCancel: boolean;
	readonly showStop: boolean;
	readonly showThinking: boolean;
	readonly showConnectingOverlay: boolean;
	readonly showConversation: boolean;
	readonly showReadyPlaceholder: boolean;
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

export function deriveLiveCanonicalActivity(input: LiveSessionWorkInput): CanonicalSessionActivity {
	const canonical = input.canonicalProjection;
	if (canonical == null) {
		return "idle";
	}

	if (
		canonical.activeTurnFailure != null ||
		canonical.lifecycle.status === "failed" ||
		canonical.lifecycle.errorMessage != null
	) {
		return "error";
	}

	return canonicalActivityFromGraphActivity(canonical.activity) ?? "idle";
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
	const canonicalActivity = deriveLiveCanonicalActivity(input);
	const pendingQuestion =
		canonicalActivity === "waiting_for_user" ? input.interactionSnapshot.pendingQuestion : null;
	const pendingPlanApproval =
		canonicalActivity === "waiting_for_user"
			? input.interactionSnapshot.pendingPlanApproval
			: null;
	const pendingPermission =
		canonicalActivity === "waiting_for_user" ? input.interactionSnapshot.pendingPermission : null;

	return deriveSessionState({
		connectionState: deriveLiveConnectionState(input),
		modeId: input.currentModeId,
		tool: null,
		pendingQuestion,
		pendingPlanApproval,
		pendingPermission,
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

function selectPresentationConnectionPhase(
	input: LiveSessionLifecyclePresentationInput
): ConnectionPhase {
	const canonical = input.canonicalProjection;
	if (canonical == null) {
		return "disconnected";
	}

	if (
		canonical.activeTurnFailure != null ||
		canonical.lifecycle.status === "failed" ||
		canonical.lifecycle.errorMessage != null
	) {
		return "failed";
	}

	if (
		canonical.lifecycle.status === "activating" ||
		canonical.lifecycle.status === "reconnecting"
	) {
		return "connecting";
	}

	if (
		canonical.lifecycle.status === "reserved" ||
		canonical.lifecycle.status === "detached" ||
		canonical.lifecycle.status === "archived"
	) {
		return "disconnected";
	}

	return "connected";
}

function selectPresentationActivityPhase(
	canonicalActivity: CanonicalSessionActivity
): ActivityPhase {
	if (canonicalActivity === "awaiting_model" || canonicalActivity === "waiting_for_user") {
		return "waiting_for_user";
	}

	if (canonicalActivity === "running_operation" || canonicalActivity === "paused") {
		return "running";
	}

	return "idle";
}

export function deriveLiveSessionLifecyclePresentation(
	input: LiveSessionLifecyclePresentationInput
): LiveSessionLifecyclePresentation {
	const canonicalActivity = deriveLiveCanonicalActivity({
		canonicalProjection: input.canonicalProjection,
		currentModeId: null,
		interactionSnapshot: {
			pendingPlanApproval: null,
			pendingPermission: null,
			pendingQuestion: null,
		},
		hasUnseenCompletion: false,
	});
	const connectionPhase = selectPresentationConnectionPhase(input);
	const contentPhase: ContentPhase = input.hasEntries ? "loaded" : "empty";
	const activityPhase = selectPresentationActivityPhase(canonicalActivity);
	const canCancel =
		canonicalActivity === "awaiting_model" ||
		canonicalActivity === "waiting_for_user" ||
		canonicalActivity === "running_operation" ||
		canonicalActivity === "paused";
	const showThinking =
		canonicalActivity === "awaiting_model" || canonicalActivity === "waiting_for_user";
	const canSubmit =
		input.canonicalProjection?.lifecycle.actionability.canSend === true &&
		!input.hasLocalPendingSendIntent;
	const showConversation = contentPhase === "loaded";

	return {
		connectionPhase,
		contentPhase,
		activityPhase,
		canSubmit,
		canCancel,
		showStop: canCancel,
		showThinking,
		showConnectingOverlay: connectionPhase === "connecting" && !showConversation,
		showConversation,
		showReadyPlaceholder:
			!showConversation &&
			input.canonicalProjection?.lifecycle.status === "ready" &&
			canonicalActivity === "idle",
	};
}
