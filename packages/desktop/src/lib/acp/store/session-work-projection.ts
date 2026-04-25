import type { SessionStatus } from "../application/dto/session-status.js";
import type { CanonicalSessionActivity } from "../logic/session-activity.js";
import type { ActiveTurnFailure } from "../types/turn-error.js";
import type { SessionState } from "./session-state.js";

export type SessionWorkBucket =
	| "answer_needed"
	| "planning"
	| "working"
	| "needs_review"
	| "idle"
	| "error";

export type SessionIntentFamily = "planning" | "working" | "none";

export type SessionCompactActivityKind = "idle" | "thinking" | "streaming" | "paused";

export interface SessionWorkProjectionInput {
	readonly state: SessionState;
	readonly currentModeId: string | null;
	readonly connectionError: string | null;
	readonly activeTurnFailure?: ActiveTurnFailure | null;
	readonly canonicalActivity?: CanonicalSessionActivity | null;
}

export interface SessionWorkProjection {
	readonly state: SessionState;
	readonly currentModeId: string | null;
	readonly effectiveModeId: string | null;
	readonly canonicalActivity: CanonicalSessionActivity | null;
	readonly intentFamily: SessionIntentFamily;
	readonly compactActivityKind: SessionCompactActivityKind;
	readonly hasPendingInput: boolean;
	readonly hasError: boolean;
	readonly hasSecondaryError: boolean;
	readonly needsReview: boolean;
	readonly acknowledgeable: boolean;
}

function resolveEffectiveModeId(input: SessionWorkProjectionInput): string | null {
	if (input.currentModeId !== null) {
		return input.currentModeId;
	}

	if (input.state.activity.kind === "streaming") {
		return input.state.activity.modeId;
	}

	return null;
}

function resolveIntentFamily(
	state: SessionState,
	effectiveModeId: string | null
): SessionIntentFamily {
	if (
		state.activity.kind !== "streaming" &&
		state.activity.kind !== "thinking" &&
		state.activity.kind !== "paused"
	) {
		return "none";
	}

	if (effectiveModeId === "plan") {
		return "planning";
	}

	return "working";
}

function resolveCompactActivityKind(state: SessionState): SessionCompactActivityKind {
	if (state.activity.kind === "thinking") {
		return "thinking";
	}

	if (state.activity.kind === "streaming") {
		return "streaming";
	}

	if (state.activity.kind === "paused") {
		return "paused";
	}

	return "idle";
}

export function compactActivityKindFromCanonicalActivity(
	canonicalActivity: CanonicalSessionActivity | null
): SessionCompactActivityKind {
	if (canonicalActivity === "awaiting_model" || canonicalActivity === "waiting_for_user") {
		return "thinking";
	}

	if (canonicalActivity === "running_operation") {
		return "streaming";
	}

	if (canonicalActivity === "paused") {
		return "paused";
	}

	return "idle";
}

export function deriveSessionWorkProjection(
	input: SessionWorkProjectionInput
): SessionWorkProjection {
	const effectiveModeId = resolveEffectiveModeId(input);
	const hasPendingInput = input.state.pendingInput.kind !== "none";
	const hasError =
		input.state.connection === "error" ||
		input.connectionError != null ||
		input.activeTurnFailure != null;
	const needsReview =
		input.state.activity.kind === "idle" && input.state.attention.hasUnseenCompletion;

	return {
		state: input.state,
		currentModeId: input.currentModeId,
		effectiveModeId,
		canonicalActivity: input.canonicalActivity ?? null,
		intentFamily: resolveIntentFamily(input.state, effectiveModeId),
		compactActivityKind:
			input.canonicalActivity != null
				? compactActivityKindFromCanonicalActivity(input.canonicalActivity)
				: resolveCompactActivityKind(input.state),
		hasPendingInput,
		hasError,
		hasSecondaryError: hasPendingInput && hasError,
		needsReview,
		acknowledgeable: needsReview,
	};
}

export function selectSessionWorkBucket(projection: SessionWorkProjection): SessionWorkBucket {
	if (projection.hasPendingInput) {
		return "answer_needed";
	}

	if (projection.hasError) {
		return "error";
	}

	if (projection.intentFamily === "planning") {
		return "planning";
	}

	if (projection.intentFamily === "working") {
		return "working";
	}

	if (projection.needsReview) {
		return "needs_review";
	}

	return "idle";
}

export function selectQueueWorkBucket(
	projection: SessionWorkProjection
): Exclude<SessionWorkBucket, "idle"> | null {
	const bucket = selectSessionWorkBucket(projection);
	if (bucket === "idle") {
		return null;
	}
	return bucket;
}

export function selectSessionStatusForPresentation(
	projection: SessionWorkProjection
): SessionStatus {
	const { state } = projection;
	if (projection.hasError) {
		return "error";
	}

	if (state.connection === "connecting") {
		return "connecting";
	}

	if (state.connection === "disconnected") {
		return "idle";
	}

	if (state.activity.kind === "paused") {
		return "paused";
	}

	if (projection.canonicalActivity === "paused") {
		return "paused";
	}

	if (
		projection.canonicalActivity === "running_operation" ||
		projection.canonicalActivity === "awaiting_model" ||
		projection.canonicalActivity === "waiting_for_user"
	) {
		return "streaming";
	}

	if (state.activity.kind === "streaming" || state.activity.kind === "thinking") {
		return "streaming";
	}

	return "ready";
}

export function selectLegacySessionStatus(projection: SessionWorkProjection): SessionStatus {
	return selectSessionStatusForPresentation(projection);
}
