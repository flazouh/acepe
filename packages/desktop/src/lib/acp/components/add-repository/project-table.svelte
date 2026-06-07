<script lang="ts">
import { CircleNotch } from "phosphor-svelte";
import { FolderSimple } from "phosphor-svelte";
import ActionsCell from "./cells/actions-cell.svelte";

import AgentCountsCell from "./cells/agent-counts-cell.svelte";
import type { ProjectWithSessions } from "./open-project-dialog-props.js";

interface Props {
	projects: ProjectWithSessions[];
	loading: boolean;
	addedPaths: Set<string>;
	selectedAgentIds?: string[];
	onImport: (path: string, name: string) => void;
	onUndo: (path: string, name: string) => void;
}

let { projects, loading, addedPaths, selectedAgentIds, onImport, onUndo }: Props = $props();

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

function handleProjectRowKeydown(event: KeyboardEvent, project: ProjectWithSessions, isAdded: boolean): void {
	if (isAdded) return;
	if (event.key !== "Enter" && event.key !== " ") return;

	event.preventDefault();
	onImport(project.path, project.name);
}
</script>

{#if loading}
	<div class="flex items-center justify-center gap-2 py-12 text-muted-foreground">
		<CircleNotch class="size-4 animate-spin" />
		<span class="text-xs">{"Scanning for projects..."}</span>
	</div>
{:else if projects.length === 0}
	<div class="flex flex-col items-center justify-center gap-2 py-12 text-center px-6">
		<FolderSimple weight="light" class="size-8 text-muted-foreground/50" />
		<p class="text-xs text-muted-foreground">
			{"No projects with sessions found"}
		</p>
		<p class="text-[11px] text-muted-foreground/70">
			{"Start a session with an agent in a project directory, then come back here to import it."}
		</p>
	</div>
{:else}
	{#each projects as project (project.path)}
		{@const isAdded = addedPaths.has(project.path)}
		<div
			role="button"
			tabindex={isAdded ? -1 : 0}
			class="group mb-0.5 flex w-full items-center justify-between gap-2.5 rounded-md px-3 py-2 text-left transition-colors last:mb-0 {isAdded
				? 'cursor-default bg-primary/[0.12]'
				: 'cursor-pointer bg-accent/[0.45] hover:bg-accent/70 active:bg-accent/80'}"
			onclick={() => {
				if (!isAdded) onImport(project.path, project.name);
			}}
			onkeydown={(event) => handleProjectRowKeydown(event, project, isAdded)}
		>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<span class="truncate text-[12px] font-medium text-foreground">
						{project.name}
					</span>
				</div>
				<span class="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/60">
					{shortenPath(project.path)}
				</span>
			</div>

			<div class="flex shrink-0 items-center gap-2">
				<AgentCountsCell
					agentCounts={getDisplayCounts(Array.from(project.agentCounts.entries()))}
				/>
				<ActionsCell
					{isAdded}
					onImport={() => onImport(project.path, project.name)}
					onUndo={() => onUndo(project.path, project.name)}
				/>
			</div>
		</div>
	{/each}
{/if}
