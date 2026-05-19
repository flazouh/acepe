<script lang="ts">
import type { ProviderBrand } from "@acepe/ui";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { getAgentStore } from "$lib/acp/store/index.js";

import { getProviderBrandIcon } from "../constants/thread-list-constants.js";

interface Props {
	agentId: string;
	providerBrand?: ProviderBrand | null;
	providerLabel?: string | null;
	class?: string;
	size?: number;
}

let {
	agentId,
	providerBrand = null,
	providerLabel = null,
	class: className = "",
	size = 16,
}: Props = $props();

const themeState = useTheme();
const agentStore = getAgentStore();

const canonicalProviderMetadata = $derived(
	agentStore.agents.find((agent) => agent.id === agentId)?.providerMetadata ?? null
);
const effectiveProviderBrand = $derived(
	providerBrand ?? canonicalProviderMetadata?.providerBrand ?? "custom"
);
const effectiveProviderLabel = $derived(
	providerLabel ?? canonicalProviderMetadata?.displayName ?? agentId
);
const iconPath = $derived(getProviderBrandIcon(effectiveProviderBrand, themeState.effectiveTheme));
</script>

<img src={iconPath} alt={effectiveProviderLabel} class={className} width={size} height={size} />
