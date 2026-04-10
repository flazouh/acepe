import type { Agent, AgentAvailabilityKind } from "$lib/acp/store/types.js";

function isInstallableButNotInstalled(
	availabilityKind: AgentAvailabilityKind | undefined
): boolean {
	return availabilityKind ? availabilityKind.installed === false : false;
}

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
			continue;
		}

		if (isInstallableButNotInstalled(agent.availability_kind)) {
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
