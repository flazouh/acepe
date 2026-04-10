import { AGENT_IDS } from "../types/agent-id.js";

export type OpenInFinderTargetCapability = "project-path" | "claude-session";

export interface AgentCapabilities {
	openInFinderTarget: OpenInFinderTargetCapability;
}

const DEFAULT_AGENT_CAPABILITIES = {
	openInFinderTarget: "project-path",
} as const satisfies AgentCapabilities;

const AGENT_CAPABILITY_OVERRIDES: Readonly<
	Record<string, Readonly<Partial<AgentCapabilities>>>
> = {
	[AGENT_IDS.CLAUDE_CODE]: {
		openInFinderTarget: "claude-session",
	},
};

export function getAgentCapabilities(
	agentId: string | null | undefined
): AgentCapabilities {
	const overrides =
		agentId != null && agentId in AGENT_CAPABILITY_OVERRIDES
			? AGENT_CAPABILITY_OVERRIDES[agentId as keyof typeof AGENT_CAPABILITY_OVERRIDES]
			: undefined;

	return {
		openInFinderTarget:
			overrides?.openInFinderTarget ?? DEFAULT_AGENT_CAPABILITIES.openInFinderTarget,
	};
}
