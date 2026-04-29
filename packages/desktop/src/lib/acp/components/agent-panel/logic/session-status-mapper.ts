import type {
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionTurnState,
} from "$lib/services/acp-types.js";
import type { SessionStatus } from "../../../application/dto/session";
import type { SessionStatusUI } from "../types";

export interface CanonicalSessionPresentationStatusInput {
	readonly lifecycle: SessionGraphLifecycle | null | undefined;
	readonly activity?: SessionGraphActivity | null;
	readonly turnState?: SessionTurnState | null;
	readonly hasEntries?: boolean;
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
