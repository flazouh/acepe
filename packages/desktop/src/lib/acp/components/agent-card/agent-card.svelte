<script lang="ts">
import { cn } from "$lib/utils.js";

import type { AgentCardProps } from "./agent-card-props.js";

let {
	agentId: _agentId,
	agentName,
	iconSrc,
	isAvailable = true,
	isSelected = false,
	onclick,
}: AgentCardProps = $props();
</script>

<button
	class={cn(
		"relative flex flex-col items-center justify-center gap-3 rounded-xl border p-6 transition-all",
		"h-32 w-40",
		isSelected && isAvailable
			? "border-border bg-card shadow-md"
			: "border-border/60 bg-card/30 hover:bg-card/50",
		!isAvailable && "cursor-not-allowed grayscale opacity-50"
	)}
	disabled={!isAvailable}
	{onclick}
>
	{#if isSelected && isAvailable}
		<svg
			class="absolute top-2.5 right-2.5 size-4 text-primary"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M20 6 9 17l-5-5" />
		</svg>
	{/if}
	<img src={iconSrc} alt={`${agentName} icon`} class="size-10" />
	<span class="text-sm font-medium text-foreground">{agentName}</span>
</button>
