<script lang="ts">
import AgentIcon from "../../agent-icon.svelte";

let { agentCounts }: { agentCounts: [string, number | "loading" | "error"][] } = $props();
</script>

{#if agentCounts.length > 0}
	<div class="flex items-center gap-1">
		{#each agentCounts as [agentId, count] (agentId)}
			<div
				class="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/40 border border-border/30"
			>
				<AgentIcon {agentId} size={12} />
				<span class="text-[10px] text-muted-foreground font-medium tabular-nums">
					{typeof count === "number" ? count : "..."}
				</span>
			</div>
		{/each}
	</div>
{/if}
