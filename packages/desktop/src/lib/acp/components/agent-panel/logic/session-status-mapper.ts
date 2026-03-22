import type { SessionStatus } from "../../../application/dto/session";
import type { SessionStatusUI } from "../types";

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
