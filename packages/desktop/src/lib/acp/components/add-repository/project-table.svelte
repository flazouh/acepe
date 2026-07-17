<script lang="ts">
import {
	Table,
	TableBody,
	TableCell,
	TableRow,
	LoadingIcon,
	HugeiconsIcon,
} from "@acepe/ui";
import { cn } from "$lib/utils.js";

import ActionsCell from "./cells/actions-cell.svelte";
import AgentCountsCell from "./cells/agent-counts-cell.svelte";
import type { ProjectWithSessions } from "./project-discovery.js";

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
	<div class="flex min-h-[10rem] w-full items-center justify-center gap-2 text-muted-foreground">
		<LoadingIcon class="shrink-0" size={16} aria-label="Scanning for projects" />
		<span class="text-xs">{"Scanning for projects..."}</span>
	</div>
{:else if projects.length === 0}
	<div class="flex min-h-[10rem] w-full flex-col items-center justify-center gap-2 px-6 text-center">
		<HugeiconsIcon name="folder" class="size-8 text-muted-foreground/50" />
		<p class="text-xs text-muted-foreground">
			{"No projects with sessions found"}
		</p>
		<p class="text-[11px] text-muted-foreground/70">
			{"Start a session with an agent in a project directory, then come back here to import it."}
		</p>
	</div>
{:else}
	<Table class="acepe-table-wrapper-fill project-table-tiled-actions w-full" style="table-layout: fixed; width: 100%;">
		<colgroup>
			<col style="width: 20%;" />
			<col style="width: 50%;" />
			<col style="width: 25%;" />
			<col style="width: 5%;" />
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
					<TableCell class="overflow-hidden whitespace-nowrap">
							<AgentCountsCell
								agentCounts={getDisplayCounts(Array.from(project.agentCounts.entries()))}
							/>
						</TableCell>
						<TableCell class="whitespace-nowrap">
							<div class="flex justify-center">
								<ActionsCell
									{isAdded}
									onImport={() => onImport(project.path, project.name)}
									onUndo={() => onUndo(project.path, project.name)}
								/>
							</div>
						</TableCell>
					</TableRow>
				{/each}
			</TableBody>
		</Table>
{/if}

<style>
	/*
	 * The base table treats any `td:has(button)` as a fill-less action cell.
	 * Here the add/remove action reads as a proper column, so re-apply the same
	 * data-tile fill as the other cells, with equal padding on all sides and the
	 * icon vertically centered (base cells are `vertical-align: top`). Scoped to
	 * this table via the extra `.project-table-tiled-actions` class so other
	 * tables keep the no-fill default; the two-class selector out-specifies the
	 * base `:has(button)` rule.
	 */
	:global(.acepe-table-wrapper.project-table-tiled-actions td:has(button)) {
		background: color-mix(in srgb, var(--foreground) 5%, transparent);
		padding: 0.25rem;
		vertical-align: middle;
	}
	/*
	 * Rows don't highlight on hover in this table — hold every tile at its rest
	 * fill so the add button's own hover background is the only hover feedback.
	 */
	:global(.acepe-table-wrapper.project-table-tiled-actions tbody tr:hover td) {
		background: color-mix(in srgb, var(--foreground) 5%, transparent);
	}
</style>
