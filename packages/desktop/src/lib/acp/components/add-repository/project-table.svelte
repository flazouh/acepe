<script lang="ts">
import { CircleNotch } from "phosphor-svelte";
import { FolderSimple } from "phosphor-svelte";
import {
	Table,
	TableBody,
	TableCell,
	TableRow,
} from "@acepe/ui/table";
import { cn } from "$lib/utils.js";

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

function displayPath(path: string): string {
	return path.replace(/^\/Users\/[^/]+/, "~");
}

function handleProjectRowKeydown(event: KeyboardEvent, project: ProjectWithSessions, isAdded: boolean): void {
	if (isAdded) return;
	if (event.key !== "Enter" && event.key !== " ") return;

	event.preventDefault();
	onImport(project.path, project.name);
}
</script>

{#if loading}
	<div class="flex h-full min-h-0 w-full items-center justify-center gap-2 text-muted-foreground">
		<CircleNotch class="size-4 animate-spin" />
		<span class="text-xs">{"Scanning for projects..."}</span>
	</div>
{:else if projects.length === 0}
	<div class="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-6 text-center">
		<FolderSimple weight="light" class="size-8 text-muted-foreground/50" />
		<p class="text-xs text-muted-foreground">
			{"No projects with sessions found"}
		</p>
		<p class="text-[11px] text-muted-foreground/70">
			{"Start a session with an agent in a project directory, then come back here to import it."}
		</p>
	</div>
{:else}
	<Table class="acepe-table-wrapper-fill h-full min-h-0 w-full" style="table-layout: fixed; width: 100%;">
		<colgroup>
			<col style="width: 20%;" />
			<col style="width: 52%;" />
			<col style="width: 16%;" />
			<col style="width: 12%;" />
		</colgroup>
		<TableBody>
				{#each projects as project (project.path)}
					{@const isAdded = addedPaths.has(project.path)}
					<TableRow
						class={cn(isAdded ? "cursor-default" : "cursor-pointer", isAdded && "opacity-80")}
						role={isAdded ? undefined : "button"}
						tabindex={isAdded ? -1 : 0}
						onclick={() => {
							if (!isAdded) onImport(project.path, project.name);
						}}
						onkeydown={(event) => handleProjectRowKeydown(event, project, isAdded)}
					>
					<TableCell class="min-w-0">
						<span class="block truncate font-medium" title={project.name}>
							{project.name}
						</span>
					</TableCell>
					<TableCell class="min-w-0">
						<span class="block truncate font-mono text-muted-foreground" title={project.path}>
							{displayPath(project.path)}
						</span>
					</TableCell>
					<TableCell class="whitespace-nowrap">
							<AgentCountsCell
								agentCounts={getDisplayCounts(Array.from(project.agentCounts.entries()))}
							/>
						</TableCell>
						<TableCell class="whitespace-nowrap text-right">
							<ActionsCell
								{isAdded}
								onImport={() => onImport(project.path, project.name)}
								onUndo={() => onUndo(project.path, project.name)}
							/>
						</TableCell>
					</TableRow>
				{/each}
			</TableBody>
		</Table>
{/if}
