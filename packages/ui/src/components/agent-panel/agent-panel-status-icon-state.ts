import type { AgentSessionStatus } from "./types.js";

export type AgentPanelStatusIconPresentation = "none" | "loading" | "error";

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

	// Connected/idle/done/running intentionally show no header status icon.
	return "none";
}
