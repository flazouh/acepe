<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui/icons";
import { cn } from "../../../utils.js";

import type { AgentCardProps } from "./agent-card-props.js";

let {
	agentId: _agentId,
	agentName,
	iconSrc,
	isSelected = false,
	onclick,
}: AgentCardProps = $props();
</script>

<button
	class={cn(
		"relative flex flex-col items-center justify-center gap-3 rounded-xl border p-6 transition-all",
		"h-32 w-40",
		isSelected
			? "border-border bg-card shadow-md"
			: "border-border/60 bg-card/30 hover:bg-card/50"
	)}
	{onclick}
>
	{#if isSelected}
		<HugeiconsIcon name="check" class="absolute top-2.5 right-2.5 size-4 text-primary" />
	{/if}
	<img src={iconSrc} alt={`${agentName} icon`} class="size-10" />
	<span class="text-sm font-medium text-foreground">{agentName}</span>
</button>
