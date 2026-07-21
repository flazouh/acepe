import type {
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionTurnState,
} from "$lib/services/acp-types.js";
import type { SessionStatus } from "../../../application/dto/session-status";
import { mapCanonicalTurnStateToPresentationStatus } from "../../../store/canonical-turn-state-mapping.js";
import type { TurnState } from "../../../store/types.js";
import type { SessionStatusUI } from "../types";
import type { LocalPlaceholderMode } from "./local-placeholder-mode.js";

export interface CanonicalSessionPresentationStatusInput {
	readonly lifecycle: SessionGraphLifecycle | null | undefined;
	readonly activity?: SessionGraphActivity | null;
	readonly turnState?: SessionTurnState | null;
	readonly hasEntries?: boolean;
}

export type CanonicalAgentPanelSessionSource =
	| {
			readonly kind: "no_session";
	  }
	| {
			readonly kind: "canonical";
			readonly lifecycle: SessionGraphLifecycle;
			readonly activity: SessionGraphActivity | null;
			readonly turnState: SessionTurnState | null;
	  }
	| {
			readonly kind: "missing_canonical";
			readonly sessionId: string;
	  };

export interface CanonicalAgentPanelSessionStateInput {
	readonly source: CanonicalAgentPanelSessionSource;
	readonly hasEntries?: boolean;
	readonly hasOptimisticPendingEntry?: boolean;
	readonly hasLocalPendingSendIntent?: boolean;
	readonly hasTrailingCompletedTool: boolean;
}

export interface CanonicalAgentPanelSessionState {
	readonly sessionStatus: SessionStatusUI;
	readonly isConnected: boolean;
	readonly isStreaming: boolean;
	readonly localPlaceholderMode: LocalPlaceholderMode;
	readonly canSubmit: boolean;
	readonly showStop: boolean;
}

export interface CanonicalAgentPanelSessionSourceInput {
	readonly sessionId: string | null;
	readonly lifecycle: SessionGraphLifecycle | null;
	readonly activity: SessionGraphActivity | null;
	readonly turnState: SessionTurnState | null;
}

/**
 * Maps domain session status to UI display status.
 *
 * Pure function that converts internal session states to user-facing statuses:
 * - `idle`/`connecting` → `warming` (loading/connecting state)
 * - `ready`/`streaming` → `connected` (active connection)
 * - `error` → `error` (error state)
 * - Missing/unknown → `empty` (no session)
 *
 * @param status - Domain session status
 * @returns UI status for display
 *
 * @example
 * ```ts
 * mapSessionStatusToUI("connecting"); // "warming"
 * mapSessionStatusToUI("ready");      // "connected"
 * mapSessionStatusToUI("error");      // "error"
 * mapSessionStatusToUI(undefined);    // "empty"
 * ```
 */
export function mapSessionStatusToUI(status: SessionStatus | undefined | null): SessionStatusUI {
	if (!status) {
		return "empty";
	}

	switch (status) {
		case "connecting":
			return "warming";

		case "idle":
			return "empty";

		case "ready":
		case "streaming":
			return "connected";

		case "error":
			return "error";

		default:
			return "empty";
	}
}

export function mapCanonicalSessionToPanelStatus(
	input: CanonicalSessionPresentationStatusInput
): SessionStatusUI {
	if (input.lifecycle === null || input.lifecycle === undefined) {
		return input.hasEntries === true ? "idle" : "empty";
	}

	if (
		input.lifecycle.status === "reserved" ||
		input.lifecycle.status === "activating" ||
		input.lifecycle.status === "reconnecting"
	) {
		return "warming";
	}

	if (input.lifecycle.status === "failed") {
		return "error";
	}

	if (input.turnState === "Failed") {
		return "error";
	}

	if (input.lifecycle.status === "detached" || input.lifecycle.status === "archived") {
		return "idle";
	}

	if (
		input.activity?.kind === "running_operation" ||
		input.activity?.kind === "awaiting_model" ||
		input.activity?.kind === "waiting_for_user" ||
		input.turnState === "Running"
	) {
		return "running";
	}

	if (input.turnState === "Completed") {
		return "done";
	}

	return "connected";
}

export function resolveCanonicalAgentPanelSessionSource(
	input: CanonicalAgentPanelSessionSourceInput
): CanonicalAgentPanelSessionSource {
	if (input.sessionId === null) {
		return {
			kind: "no_session",
		};
	}

	if (input.lifecycle === null) {
		return {
			kind: "missing_canonical",
			sessionId: input.sessionId,
		};
	}

	return {
		kind: "canonical",
		lifecycle: input.lifecycle,
		activity: input.activity,
		turnState: input.turnState,
	};
}

export function resolveCanonicalAgentPanelTurnState(
	source: CanonicalAgentPanelSessionSource
): TurnState {
	if (source.kind === "missing_canonical") {
		return "error";
	}

	if (source.kind !== "canonical" || source.turnState === null) {
		return "idle";
	}

	return mapCanonicalTurnStateToPresentationStatus(source.turnState);
}

function isCanonicalBusy(
	activity: SessionGraphActivity | null | undefined,
	turnState: SessionTurnState | null | undefined
): boolean {
	// A provider may keep its turn open while it waits for a user reply. The
	// canonical activity is more specific than that open turn, so preserve the
	// send-capable composer instead of presenting a Stop action.
	if (activity?.kind === "waiting_for_user") {
		return false;
	}

	return (
		activity?.kind === "running_operation" ||
		activity?.kind === "awaiting_model" ||
		turnState === "Running"
	);
}

export function deriveCanonicalAgentPanelSessionState(
	input: CanonicalAgentPanelSessionStateInput
): CanonicalAgentPanelSessionState {
	if (input.source.kind === "missing_canonical") {
		const hasPendingSessionStart =
			input.hasLocalPendingSendIntent === true || input.hasOptimisticPendingEntry === true;

		return {
			sessionStatus: hasPendingSessionStart ? "warming" : "error",
			isConnected: false,
			isStreaming: false,
			localPlaceholderMode: hasPendingSessionStart ? "connection" : "none",
			canSubmit: false,
			showStop: false,
		};
	}

	if (input.source.kind === "no_session") {
		return {
			sessionStatus: input.hasOptimisticPendingEntry === true ? "warming" : "empty",
			isConnected: false,
			isStreaming: false,
			localPlaceholderMode: input.hasOptimisticPendingEntry === true ? "connection" : "none",
			canSubmit: false,
			showStop: false,
		};
	}

	const effectiveActivity = input.source.activity;
	const effectiveTurnState = input.source.turnState;
	const hasCanonicalError =
		input.source.lifecycle.status === "failed" || effectiveTurnState === "Failed";
	const isBusy = hasCanonicalError ? false : isCanonicalBusy(effectiveActivity, effectiveTurnState);
	const isConnecting =
		input.source.lifecycle.status === "reserved" ||
		input.source.lifecycle.status === "activating" ||
		input.source.lifecycle.status === "reconnecting";
	const shouldShowPlanningPlaceholder =
		input.source.lifecycle.status === "ready" &&
		effectiveActivity?.kind === "awaiting_model" &&
		effectiveTurnState === "Running" &&
		(input.hasLocalPendingSendIntent === true || input.hasTrailingCompletedTool);
	let localPlaceholderMode: LocalPlaceholderMode = "none";
	if (
		!hasCanonicalError &&
		isConnecting &&
		(input.hasOptimisticPendingEntry === true || input.hasLocalPendingSendIntent === true)
	) {
		localPlaceholderMode = "connection";
	} else if (!hasCanonicalError && shouldShowPlanningPlaceholder) {
		localPlaceholderMode = "planning";
	}
	const baseStatus = mapCanonicalSessionToPanelStatus({
		lifecycle: input.source.lifecycle,
		activity: effectiveActivity,
		turnState: effectiveTurnState,
		hasEntries: input.hasEntries,
	});
	const sessionStatus =
		input.hasLocalPendingSendIntent === true && baseStatus === "done" ? "connected" : baseStatus;

	return {
		sessionStatus,
		isConnected: input.source.lifecycle.status === "ready",
		isStreaming: isBusy,
		localPlaceholderMode,
		canSubmit:
			input.hasLocalPendingSendIntent === true
				? false
				: !isBusy && input.source.lifecycle.actionability.canSend === true,
		showStop: isBusy,
	};
}
