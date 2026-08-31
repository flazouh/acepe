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
			/**
			 * The canonical streaming tail, or null while nothing streams.
			 * Optional so older callers and fixtures read as "no tail".
			 */
			readonly activeStreamingTail?: { readonly rowId: string } | null;
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
	// A local send intent is set synchronously on the client the instant the
	// user hits send (see SessionMessagingService.setPendingSendIntent). The
	// canonical `awaiting_model`/`Running` envelope only arrives after a round
	// trip to the server, so gating the placeholder on that envelope alone
	// leaves a blank panel between send and first token. Trust the local send
	// intent immediately; past that, the canonical signal that means "the
	// model is working and nothing is visible yet" is awaiting_model + Running
	// with NO active streaming tail. The tail check is what ends the
	// placeholder: activity stays awaiting_model while tokens stream (see the
	// bridge's onTokenAppended), so without it the row would sit under the
	// streaming reply. An earlier version demanded a trailing completed tool
	// instead, which made the placeholder vanish for the whole model wait of
	// a plain text turn -- the send intent clears the moment the canonical
	// user entry lands, long before the first token.
	const shouldShowPlanningPlaceholder =
		input.source.lifecycle.status === "ready" &&
		(input.hasLocalPendingSendIntent === true ||
			(effectiveActivity?.kind === "awaiting_model" &&
				effectiveTurnState === "Running" &&
				(input.source.activeStreamingTail ?? null) === null));
	let localPlaceholderMode: LocalPlaceholderMode = "none";
	// #268 defect 3: a turn blocked on an unanswered approval (activity.kind
	// === "waiting_for_user") used to fall through to the same endless
	// "planning" spark as an in-flight model call, with nothing telling the
	// user WHY it stalled -- the exact hang the owner filmed. Checked first so
	// it wins over "planning"/"connection" whenever the canonical activity
	// says the turn is actually blocked, not merely mid-flight.
	if (!hasCanonicalError && effectiveActivity?.kind === "waiting_for_user") {
		localPlaceholderMode = "waiting_for_approval";
	} else if (
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
