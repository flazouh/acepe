import type { Agent } from "$lib/acp/store/types.js";

/**
 * Returns only the agents the user has explicitly selected/enabled.
 * Unselected agents (including installable-but-not-installed ones) are excluded
 * so the chat bubble and session creation flows only show active agents.
 */
export function getSpawnableSessionAgents(
	agents: readonly Agent[],
	selectedAgentIds: readonly string[]
): Agent[] {
	const selectedAgentIdSet = new Set<string>();
	for (const selectedAgentId of selectedAgentIds) {
		selectedAgentIdSet.add(selectedAgentId);
	}

	const visibleAgents: Agent[] = [];
	for (const agent of agents) {
		if (selectedAgentIdSet.has(agent.id)) {
			visibleAgents.push(agent);
		}
	}

	return visibleAgents;
}

export function ensureSpawnableAgentSelected(
	selectedAgentIds: readonly string[],
	agentId: string
): string[] {
	const nextSelectedAgentIds: string[] = [];
	let agentAlreadySelected = false;

	for (const selectedAgentId of selectedAgentIds) {
		nextSelectedAgentIds.push(selectedAgentId);
		if (selectedAgentId === agentId) {
			agentAlreadySelected = true;
		}
	}

	if (!agentAlreadySelected) {
		nextSelectedAgentIds.push(agentId);
	}

	return nextSelectedAgentIds;
}
