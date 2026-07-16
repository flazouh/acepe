import type { AgentInfo } from "$lib/acp/logic/agent-manager.js";
import type { Agent } from "$lib/acp/store/types.js";
import { getSpawnableSessionAgents } from "../logic/spawnable-agents.js";

interface NewChatAgentSelectorModelInput {
	readonly agents: readonly Agent[];
	readonly selectedAgentIds: readonly string[];
	readonly selectedProjectPath: string | null;
}

interface NewChatAgentSelectorModel {
	readonly availableAgents: AgentInfo[];
	readonly projectPath: string | null;
}

export function buildNewChatAgentSelectorModel(
	input: NewChatAgentSelectorModelInput
): NewChatAgentSelectorModel {
	const availableAgents = getSpawnableSessionAgents(input.agents, input.selectedAgentIds).map(
		(agent): AgentInfo => ({
			id: agent.id,
			name: agent.name,
			icon: agent.icon,
			availability_kind: agent.availability_kind,
			default_selection_rank: agent.default_selection_rank,
			provider_metadata: agent.providerMetadata,
			supports_project_discovery: agent.supportsProjectDiscovery ?? false,
		})
	);

	return {
		availableAgents,
		projectPath: input.selectedProjectPath,
	};
}
