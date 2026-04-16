import type { SessionRuntimeState } from "../logic/session-ui-state.js";
import type { ToolCall } from "../types/tool-call.js";
import type { SessionOperationInteractionSnapshot } from "./operation-association.js";
import { deriveSessionState, type SessionState } from "./session-state.js";
import {
	deriveSessionWorkProjection,
	type SessionCompactActivityKind,
	type SessionWorkProjection,
} from "./session-work-projection.js";
import type { SessionHotState } from "./types.js";

export interface LiveSessionWorkInput {
	readonly runtimeState: SessionRuntimeState | null;
	readonly hotState: Pick<
		SessionHotState,
		"status" | "currentMode" | "connectionError" | "activeTurnFailure"
	>;
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

function deriveLiveConnectionState(input: LiveSessionWorkInput): LiveConnectionState {
	if (input.runtimeState === null) {
		const hotStatus = input.hotState.status;
		if (hotStatus === "idle") {
			return "disconnected";
		}
		if (hotStatus === "loading" || hotStatus === "connecting") {
			return "connecting";
		}
		if (hotStatus === "streaming") {
			return "streaming";
		}
		if (hotStatus === "paused") {
			return "paused";
		}
		if (hotStatus === "error") {
			return "error";
		}
		return "ready";
	}

	if (input.runtimeState.connectionPhase === "failed") {
		return "error";
	}

	if (input.runtimeState.connectionPhase === "connecting") {
		return "connecting";
	}

	if (input.runtimeState.connectionPhase === "disconnected") {
		return "disconnected";
	}

	if (input.hotState.status === "paused") {
		return "paused";
	}

	if (input.runtimeState.showThinking) {
		return "awaitingResponse";
	}

	if (input.runtimeState.activityPhase === "waiting_for_user") {
		return "awaitingResponse";
	}

	if (input.runtimeState.activityPhase === "running") {
		return "streaming";
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
	return deriveSessionWorkProjection({
		state,
		currentModeId: input.hotState.currentMode ? input.hotState.currentMode.id : null,
		connectionError: input.hotState.connectionError,
		activeTurnFailure: input.hotState.activeTurnFailure ?? null,
	});
}

export function selectLiveCompactActivityKind(
	input: LiveSessionWorkInput
): SessionCompactActivityKind {
	return deriveLiveSessionWorkProjection(input).compactActivityKind;
}
