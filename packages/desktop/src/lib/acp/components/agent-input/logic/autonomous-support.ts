import type { ConnectionPhase } from "../../../logic/session-ui-state.js";
import type { Agent } from "../../../store/types.js";

function getSupportedModeIds(agent: Agent | undefined): ReadonlyArray<string> {
	if (!agent || !agent.autonomous_supported_mode_ids) {
		return [];
	}

	return agent.autonomous_supported_mode_ids;
}

export function resolveAutonomousSupport(input: {
	readonly agentId: string | null;
	readonly connectionPhase: ConnectionPhase | null;
	readonly currentUiModeId: string | null;
	readonly agents: ReadonlyArray<Agent>;
}): {
	readonly supported: boolean;
	readonly disabledReason: "not-live" | "unsupported-agent" | "unsupported-mode" | null;
} {
	if (input.connectionPhase !== "connected") {
		return {
			supported: false,
			disabledReason: "not-live",
		};
	}

	if (!input.agentId) {
		return {
			supported: false,
			disabledReason: "unsupported-agent",
		};
	}

	const agent = input.agents.find((candidate) => candidate.id === input.agentId);
	const supportedModeIds = getSupportedModeIds(agent);
	if (supportedModeIds.length === 0) {
		return {
			supported: false,
			disabledReason: "unsupported-agent",
		};
	}

	if (!input.currentUiModeId || !supportedModeIds.includes(input.currentUiModeId)) {
		return {
			supported: false,
			disabledReason: "unsupported-mode",
		};
	}

	return {
		supported: true,
		disabledReason: null,
	};
}