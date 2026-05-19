<script lang="ts">
import type { ProviderBrand } from "@acepe/ui";
import { getProviderBrandIconSrc } from "$lib/provider-brand-icons.js";
import { websiteThemeStore } from "$lib/theme/theme.js";
import { cn } from "$lib/utils.js";

const AGENTS: {
	providerBrand: ProviderBrand;
	alt: string;
	sizeMultiplier?: number;
}[] = [
	{
		providerBrand: "claude-code",
		alt: "Claude",
	},
	{
		providerBrand: "codex",
		alt: "Codex",
	},
	{
		providerBrand: "cursor",
		alt: "Cursor",
		sizeMultiplier: 0.88,
	},
	{
		providerBrand: "copilot",
		alt: "Copilot",
		sizeMultiplier: 0.88,
	},
	{
		providerBrand: "opencode",
		alt: "OpenCode",
		sizeMultiplier: 0.88,
	},
];

interface Props {
	size?: number;
	class?: string;
}

let { size = 20, class: className = "" }: Props = $props();

const theme = $derived($websiteThemeStore);
</script>

<div class={cn('flex items-center justify-center gap-2', className)}>
	{#each AGENTS as agent (agent.providerBrand)}
		<div class="flex shrink-0 items-center justify-center" style="width: {size}px; height: {size}px;">
			<img
				src={getProviderBrandIconSrc(agent.providerBrand, theme)}
				alt={agent.alt}
				width={Math.round(size * (agent.sizeMultiplier ?? 1))}
				height={Math.round(size * (agent.sizeMultiplier ?? 1))}
				class="max-h-full max-w-full object-contain"
			/>
		</div>
	{/each}
</div>
