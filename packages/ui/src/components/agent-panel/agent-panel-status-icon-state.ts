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

	if (
		input.status === "connected" ||
		input.status === "done" ||
		input.status === "idle" ||
		input.status === "running"
	) {
		return "connected";
	}

	// Transient warming/connecting states intentionally show no loading affordance.
	return "none";
}
