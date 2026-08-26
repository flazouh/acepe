import type { AgentSessionStatus } from "./types.js";

export type AgentPanelStatusIconPresentation =
	| "none"
	| "loading"
	| "connected"
	| "running"
	| "error";

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

	if (input.status === "running") {
		return "running";
	}

	if (
		input.status === "connected" ||
		input.status === "idle" ||
		input.status === "done"
	) {
		return "connected";
	}

	// Warming/empty (not yet connected, not retrying) intentionally show no icon.
	return "none";
}
