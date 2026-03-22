<script lang="ts">
import { cn } from "$lib/utils.js";

interface Props {
	providerId: string;
	class?: string;
}

let { providerId, class: className }: Props = $props();

// Provider to logo mapping
const PROVIDER_LOGOS: Record<string, string> = {
	anthropic: "/logos/anthropic.svg",
	openai: "/logos/openai.svg",
	google: "/logos/google.svg",
	opencode: "/logos/opencode.svg",
};

// Fallback to first letter as badge
const logoUrl = $derived(PROVIDER_LOGOS[providerId.toLowerCase()]);
const fallbackLetter = $derived(providerId.charAt(0).toUpperCase());
</script>

{#if logoUrl}
	<img src={logoUrl} alt={providerId} class={cn("", className)} />
{:else}
	<div
		class={cn(
			"flex items-center justify-center rounded bg-muted text-muted-foreground font-medium text-[10px]",
			className
		)}
	>
		{fallbackLetter}
	</div>
{/if}
