<script lang="ts">
import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { AgentInfo } from "../logic/agent-manager.js";
import { capitalizeName } from "../utils/index.js";
import type { ProjectCardData } from "./project-card-data.js";

interface Props {
	data: ProjectCardData;
	index: number;
	availableAgents: AgentInfo[];
	effectiveTheme: "light" | "dark";
	isFocused: boolean;
	onFocus: () => void;
	onAgentSelect: (agentId: string) => void;
}

let {
	data,
	index: _index,
	availableAgents,
	effectiveTheme,
	isFocused,
	onFocus,
	onAgentSelect,
}: Props = $props();

const color = $derived(data.project.color);

function handleCardClick() {
	onFocus();
}

function handleAgentClick(e: MouseEvent, agentId: string) {
	e.stopPropagation();
	onAgentSelect(agentId);
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group flex items-center gap-2 px-2.5 h-8 rounded-md transition-all cursor-pointer
		{isFocused ? 'bg-accent/50 border border-border/50' : 'border border-transparent hover:bg-accent/30'}"
	onclick={handleCardClick}
>
	<!-- Color dot -->
	<span class="h-2 w-2 rounded-full shrink-0" style:background-color={color}></span>

	<!-- Project name -->
	<span class="text-[11px] font-semibold text-foreground truncate flex-1">
		{capitalizeName(data.project.name)}
	</span>

	<!-- Branch (subtle, only when not focused) -->
	{#if data.branch && !isFocused}
		<span class="text-[10px] text-muted-foreground/50 truncate max-w-[80px] shrink-0">
			{data.branch}
		</span>
	{/if}

	<!-- Agent icons (visible on focus) -->
	{#if isFocused}
		<div class="flex items-center gap-px shrink-0">
			{#each availableAgents as agent (agent.id)}
				{@const iconSrc = getAgentIcon(agent.id, effectiveTheme)}
				{#if agent.available}
					<button
						class="h-6 w-6 p-0.5 rounded hover:bg-accent transition-colors cursor-pointer opacity-60 hover:opacity-100"
						onclick={(e) => handleAgentClick(e, agent.id)}
					>
						<img src={iconSrc} alt={agent.name} class="h-full w-full" />
					</button>
				{:else}
					<button
						class="h-6 w-6 p-0.5 rounded opacity-15 cursor-not-allowed"
						disabled
					>
						<img src={iconSrc} alt={agent.name} class="h-full w-full grayscale" />
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>
