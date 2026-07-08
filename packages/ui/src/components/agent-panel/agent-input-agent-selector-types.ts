import type { ProviderBrand } from "../provider-mark/index.js";

export interface AgentInputAgentSelectorItem {
	readonly id: string;
	readonly name: string;
	readonly providerBrand?: ProviderBrand | null;
	readonly providerLabel?: string | null;
}

export interface AgentInputAgentSelectorIconParams {
	agentId: string;
	providerBrand: ProviderBrand | null;
	providerLabel: string;
	class: string;
	size: number;
}
