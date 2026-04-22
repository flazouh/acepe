import type { Agent } from "$lib/acp/store/types.js";

export function getOnboardingSelectableAgents(agents: readonly Agent[]): Agent[] {
	return agents.filter((agent) => agent.supportsProjectDiscovery === true);
}
