<script lang="ts">
	import type { AgentGridItem } from "./agent-selection-grid-types.js";

	interface Props {
		/**
		 * The list of agents to display in the grid.
		 */
		readonly agents: AgentGridItem[];

		/**
		 * The ID of the currently selected agent (if any).
		 */
		readonly selectedAgentId?: string | null;

		/**
		 * Called when the user clicks an available agent button.
		 * If not provided, the grid is non-interactive (display only).
		 */
		readonly onAgentSelect?: ((agentId: string) => void) | null;

		/**
		 * Optional label shown above the grid (e.g. "Choose an agent").
		 */
		readonly label?: string | null;

		/**
		 * Optional keyboard shortcut labels to show under each button.
		 * Array of [modifier, key] tuples, one per agent in order.
		 * If not provided, no shortcuts are shown.
		 */
		readonly shortcuts?: ReadonlyArray<readonly [string, string]> | null;

		/**
		 * Optional CSS class for the root element.
		 */
		readonly class?: string;
	}

	let {
		agents,
		selectedAgentId = null,
		onAgentSelect = null,
		label = null,
		shortcuts = null,
		class: className = "",
	}: Props = $props();
</script>

<div class="flex flex-col items-center gap-4 {className}">
	{#if label}
		<span class="text-sm text-muted-foreground">{label}</span>
	{/if}
	<div class="flex items-start justify-center gap-6">
		{#each agents as agent, index (agent.id)}
			{@const isSelected = agent.id === selectedAgentId}
			{@const shortcut = shortcuts?.[index] ?? null}
			<div class="flex flex-col items-center gap-2">
				<button
					type="button"
					class="flex h-14 w-14 items-center justify-center rounded-lg border border-transparent p-2 transition-colors
						{agent.available
						? isSelected
							? 'bg-accent/50 border-border/50'
							: 'hover:bg-accent/30 cursor-pointer'
						: 'opacity-50 cursor-not-allowed'}"
					disabled={!agent.available}
					onclick={() => {
						if (agent.available && onAgentSelect) {
							onAgentSelect(agent.id);
						}
					}}
				>
					<img
						src={agent.iconSrc}
						alt={agent.name}
						class="h-10 w-10 {agent.available ? '' : 'grayscale'}"
					/>
				</button>
				{#if shortcut}
					<div class="flex gap-0.5 {!agent.available ? 'opacity-50' : ''}">
						<kbd class="inline-flex min-w-0 items-center justify-center rounded border border-border/60 bg-muted/50 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{shortcut[0]}</kbd>
						<kbd class="inline-flex min-w-0 items-center justify-center rounded border border-border/60 bg-muted/50 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{shortcut[1]}</kbd>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
