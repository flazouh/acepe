<script lang="ts">
import type { ProviderBrand } from "@acepe/ui";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { getAgentStore } from "$lib/acp/store/index.js";

import {
	CODEX_APP_ICON_IMG_CLASS,
	getProviderBrandIcon,
	isCodexProviderBrand,
} from "../constants/thread-list-constants.js";

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

const canonicalProviderMetadata = $derived(agentStore?.getProviderMetadata(agentId) ?? null);
const effectiveProviderBrand = $derived(
	providerBrand ?? canonicalProviderMetadata?.providerBrand ?? null
);
const effectiveProviderLabel = $derived(
	providerLabel ?? canonicalProviderMetadata?.displayName ?? agentId
);
const iconPath = $derived(getProviderBrandIcon(effectiveProviderBrand, themeState.effectiveTheme));
const iconClass = $derived(
	[
		"block shrink-0 object-contain",
		isCodexProviderBrand(effectiveProviderBrand) ? CODEX_APP_ICON_IMG_CLASS : "",
		className,
	]
		.filter(Boolean)
		.join(" ")
);
</script>

{#if iconPath}
	<img
		src={iconPath}
		alt={effectiveProviderLabel}
		class={iconClass}
		width={size}
		height={size}
	/>
{/if}
