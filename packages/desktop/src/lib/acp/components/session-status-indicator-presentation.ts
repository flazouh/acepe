import type { SessionStatus } from "../state/index.js";

export type SessionStatusIndicatorPresentation = "none" | "connected" | "error";

export function resolveSessionStatusIndicatorPresentation(
	status: SessionStatus,
	show: boolean
): SessionStatusIndicatorPresentation {
	if (!show || status === "empty" || status === "warming") {
		return "none";
	}

	if (status === "connected") {
		return "connected";
	}

	if (status === "error") {
		return "error";
	}

	return "none";
}
