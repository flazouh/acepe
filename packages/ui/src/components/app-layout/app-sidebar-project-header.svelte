<script lang="ts">
	import type { Snippet } from "svelte";

	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import type { AppSidebarProjectHeaderAgent } from "./types.js";

	interface Props {
		projectName: string;
		projectColor: string;
		projectPath: string;
		agents: readonly AppSidebarProjectHeaderAgent[];
		onToggleAgent?: (id: string) => void;
		/** Optional overflow / actions area rendered at the end of the header row. */
		rightSlot?: Snippet;
	}

	let {
		projectName,
		projectColor,
		projectPath,
		agents,
		onToggleAgent,
		rightSlot,
	}: Props = $props();
</script>

<div data-project-path={projectPath} class="flex flex-col">
	<div class="shrink-0 flex items-center rounded-md bg-card">
		<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
			<ProjectLetterBadge name={projectName} color={projectColor} iconSrc={null} size={16} />
		</div>
		<div class="flex items-center flex-1 min-w-0 h-7 pl-2 pr-2">
			<span
				class="truncate text-[10px] font-semibold tracking-wide text-muted-foreground/70"
			>
				{projectName}
			</span>
		</div>
		{#if rightSlot}
			<div class="flex items-center pr-1">
				{@render rightSlot()}
			</div>
		{/if}
	</div>

	{#if agents.length > 0}
		<div class="flex h-7 w-full items-center justify-end gap-0.5 px-0.5">
			{#each agents as agent (agent.id)}
				<button
					type="button"
					class="flex items-center justify-center size-6 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground {agent.selected
						? 'bg-accent text-foreground'
						: ''}"
					aria-label={agent.name}
					aria-pressed={agent.selected}
					data-agent-id={agent.id}
					data-selected={agent.selected ? 'true' : 'false'}
					onclick={() => onToggleAgent?.(agent.id)}
				>
					<img src={agent.iconSrc} alt={agent.name} class="h-4 w-4 shrink-0" />
				</button>
			{/each}
		</div>
	{/if}
</div>
