<script lang="ts">
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import CircleNotch from "phosphor-svelte/lib/CircleNotch";
import FolderSimple from "phosphor-svelte/lib/FolderSimple";
import * as m from "$lib/paraglide/messages.js";
import ActionsCell from "./cells/actions-cell.svelte";

import AgentCountsCell from "./cells/agent-counts-cell.svelte";
import type { ProjectWithSessions } from "./open-project-dialog-props.js";

interface Props {
	projects: ProjectWithSessions[];
	loading: boolean;
	addedPaths: Set<string>;
	selectedAgentIds?: string[];
	onImport: (path: string, name: string) => void;
}

let { projects, loading, addedPaths, selectedAgentIds, onImport }: Props = $props();

/**
 * Filter agent counts to show only selected agents.
 * If no agents selected, show all counts.
 */
function getDisplayCounts(
	agentCounts: [string, number | "loading" | "error"][]
): [string, number | "loading" | "error"][] {
	if (!selectedAgentIds || selectedAgentIds.length === 0) {
		return agentCounts;
	}

	const selectedSet = new Set(selectedAgentIds);
	return agentCounts.filter(([agentId]) => selectedSet.has(agentId));
}

function shortenPath(path: string): string {
	const home = path.replace(/^\/Users\/[^/]+/, "~");
	const parts = home.split("/");
	if (parts.length <= 3) return home;
	return `${parts.slice(0, 2).join("/")}/.../${parts[parts.length - 1]}`;
}
</script>

{#if loading}
	<div class="flex items-center justify-center gap-2 py-12 text-muted-foreground">
		<CircleNotch class="size-4 animate-spin" />
		<span class="text-xs">{m.open_project_scanning()}</span>
	</div>
{:else if projects.length === 0}
	<div class="flex flex-col items-center justify-center gap-2 py-12 text-center px-6">
		<FolderSimple weight="light" class="size-8 text-muted-foreground/50" />
		<p class="text-xs text-muted-foreground">
			{m.open_project_empty()}
		</p>
		<p class="text-[11px] text-muted-foreground/70">
			{m.open_project_empty_hint()}
		</p>
	</div>
{:else}
	{#each projects as project (project.path)}
		{@const isAdded = addedPaths.has(project.path)}
		<button
			type="button"
		class="group flex items-center justify-between gap-3 w-full text-left px-3 py-2.5 border-b border-border/20 transition-colors {isAdded
			? 'cursor-default'
			: 'cursor-pointer hover:bg-accent/30 active:bg-accent/40'}"
			disabled={isAdded}
			onclick={() => onImport(project.path, project.name)}
		>
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2">
					<span class="text-[12px] font-medium text-foreground truncate">
						{project.name}
					</span>
					{#if isAdded}
						<CheckCircle weight="fill" class="size-3.5 text-green-500 shrink-0" />
					{/if}
				</div>
				<span class="text-[10px] text-muted-foreground/60 truncate block mt-0.5 font-mono">
					{shortenPath(project.path)}
				</span>
			</div>

			<div class="flex items-center gap-2 shrink-0">
				<AgentCountsCell
					agentCounts={getDisplayCounts(Array.from(project.agentCounts.entries()))}
				/>
				<ActionsCell {isAdded} />
			</div>
		</button>
	{/each}
{/if}
