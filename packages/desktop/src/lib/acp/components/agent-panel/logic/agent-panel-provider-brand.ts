import type { ProviderBrand } from "@acepe/ui";

interface AgentPanelProviderBrandInput {
	readonly agentId?: string | null;
	readonly sessionProviderBrand?: ProviderBrand | null;
	readonly storeProviderBrand?: ProviderBrand | null;
	readonly listedProviderBrand?: ProviderBrand | null;
}

const BUILT_IN_PROVIDER_BRANDS = [
	"claude-code",
	"copilot",
	"cursor",
	"opencode",
	"codex",
] as const satisfies readonly ProviderBrand[];

function providerBrandFromAgentId(agentId: string | null | undefined): ProviderBrand | null {
	if (agentId === null || agentId === undefined) {
		return null;
	}

	const matchingBrand = BUILT_IN_PROVIDER_BRANDS.find((brand) => brand === agentId);
	return matchingBrand ?? null;
}

function usableProviderBrand(providerBrand: ProviderBrand | null | undefined): ProviderBrand | null {
	if (providerBrand === null || providerBrand === undefined || providerBrand === "custom") {
		return null;
	}

	return providerBrand;
}

export function resolveAgentPanelProviderBrand(
	input: AgentPanelProviderBrandInput
): ProviderBrand | null {
	return (
		usableProviderBrand(input.sessionProviderBrand) ??
		providerBrandFromAgentId(input.agentId) ??
		usableProviderBrand(input.storeProviderBrand) ??
		usableProviderBrand(input.listedProviderBrand) ??
		null
	);
}
