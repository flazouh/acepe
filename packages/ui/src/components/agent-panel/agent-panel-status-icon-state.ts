import type { AgentSessionStatus } from "./types.js";

export type AgentPanelStatusIconPresentation = "none" | "loading" | "connected" | "error";

export function resolveAgentPanelStatusIconPresentation(input: {
	status: AgentSessionStatus;
	isConnecting: boolean;
	isRetrying: boolean;
}): AgentPanelStatusIconPresentation {
	if (input.isRetrying) {
		return "loading";
	}

	if (input.status === "error") {
		return "error";
	}

	// The pre-migration design: one connected presentation (the filled
	// check-circle) for every attached state; the component colors it by
	// status (idle muted, otherwise success).
	if (
		input.status === "connected" ||
		input.status === "done" ||
		input.status === "idle" ||
		input.status === "running"
	) {
		return "connected";
	}

	// Warming/empty (not yet connected, not retrying) intentionally show no icon.
	return "none";
}
