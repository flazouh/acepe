<script lang="ts">
import { IconArrowDown } from "@tabler/icons-svelte";
import { IconArrowUp } from "@tabler/icons-svelte";
import { IconChevronLeft } from "@tabler/icons-svelte";
import { IconChevronRight } from "@tabler/icons-svelte";
import { IconChevronsLeft } from "@tabler/icons-svelte";
import { IconChevronsRight } from "@tabler/icons-svelte";
import { IconSearch } from "@tabler/icons-svelte";
import { IconSelector } from "@tabler/icons-svelte";
import type { SessionSummary } from "$lib/acp/application/dto/session.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import * as m from "$lib/messages.js";
import { cn } from "$lib/utils.js";
import ActionsCell from "./columns/actions-cell.svelte";
import * as logic from "./session-table-logic.js";
import { SessionTableState } from "./session-table-state.svelte.js";
import type { SessionTableActionTarget, SortColumn } from "./session-table-types.js";

interface Props {
	sessions: readonly SessionSummary[];
	projects: readonly Project[];
	loading: boolean;
	onView?: (id: string) => void;
	onOpenInFinder?: (id: string, projectPath: string) => void;
	onArchive?: (session: SessionTableActionTarget) => void;
	onUnarchive?: (session: SessionTableActionTarget) => void;
	emptyMessage?: string;
	class?: string;
}

let {
	sessions,
	projects,
	loading,
	onView,
	onOpenInFinder,
	onArchive,
	onUnarchive,
	emptyMessage = m.settings_project_sessions_empty(),
	class: className,
}: Props = $props();

const state = new SessionTableState();

const projectColorMap = $derived(logic.createProjectColorMap(projects));
const projectNameMap = $derived(logic.createProjectNameMap(projects));
const uniqueProjects = $derived(logic.getUniqueProjects(sessions, projectNameMap, projectColorMap));
const uniqueAgents = $derived(logic.getUniqueAgents(sessions));
const tableRows = $derived(logic.createTableRows(sessions, projectNameMap, projectColorMap));
const filteredRows = $derived(
	logic.filterRows(tableRows, state.searchQuery, state.projectFilter, state.agentFilter)
);
const sortedRows = $derived(logic.sortRows(filteredRows, state.sortColumn, state.sortDirection));
const totalPages = $derived(logic.calculateTotalPages(sortedRows.length, state.pageSize));
const canGoPrevious = $derived(state.currentPage > 0);
const canGoNext = $derived(state.currentPage < totalPages - 1);
const paginatedRows = $derived(logic.paginateRows(sortedRows, state.currentPage, state.pageSize));
const isEmpty = $derived(sessions.length === 0);
const hasResults = $derived(filteredRows.length > 0);
const totalCount = $derived(sessions.length);
const filteredCount = $derived(filteredRows.length);

function handleSort(col: string) {
	state.toggleSort(col as SortColumn);
}

type Column = { id: SortColumn; label: string; class?: string };
const columns: Column[] = [
	{ id: "title", label: "Title", class: "flex-[2] min-w-0" },
	{ id: "projectName", label: "Project", class: "flex-1 min-w-0" },
	{ id: "agentId", label: "Agent", class: "w-20" },
	{ id: "entryCount", label: "#", class: "w-10 text-right" },
	{ id: "updatedAt", label: "Updated", class: "w-20 text-right" },
];

function formatDate(date: Date): string {
	const diff = Date.now() - date.getTime();
	const mn = 60_000,
		hr = 3_600_000,
		dy = 86_400_000;
	if (diff < mn) return "now";
	if (diff < hr) return `${Math.floor(diff / mn)}m`;
	if (diff < dy) return `${Math.floor(diff / hr)}h`;
	if (diff < 7 * dy) return `${Math.floor(diff / dy)}d`;
	const o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
	if (date.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
	return new Intl.DateTimeFormat("en", o).format(date);
}

function titleCase(s: string): string {
	return s
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
</script>

<div class={cn("flex flex-col gap-2 h-full min-h-0 text-sm", className)}>
	<!-- Filters -->
	<div class="flex items-center gap-2 shrink-0">
		<div class="relative flex-1">
			<IconSearch
				class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50"
			/>
			<input
				type="text"
				placeholder={m.settings_project_sessions_search()}
				value={state.searchQuery}
				oninput={(e) => state.setSearchQuery(e.currentTarget.value)}
				class="w-full h-6 pl-7 pr-2 text-sm bg-muted/30 border border-border/30 rounded-md outline-none placeholder:text-muted-foreground/40 focus:border-border/60 transition-colors"
			/>
		</div>
		<select
			class="h-6 px-1.5 text-xs bg-muted/30 border border-border/30 rounded-md text-muted-foreground outline-none"
			onchange={(e) => state.setProjectFilter(e.currentTarget.value || null)}
		>
			<option value="">{m.settings_project_sessions_all_projects()}</option>
			{#each uniqueProjects as project (project.path)}
				<option value={project.path}>{project.name}</option>
			{/each}
		</select>
		<select
			class="h-6 px-1.5 text-xs bg-muted/30 border border-border/30 rounded-md text-muted-foreground outline-none"
			onchange={(e) => state.setAgentFilter(e.currentTarget.value || null)}
		>
			<option value="">{m.settings_project_sessions_all_agents()}</option>
			{#each uniqueAgents as agent (agent)}
				<option value={agent}>{titleCase(agent)}</option>
			{/each}
		</select>
	</div>

	<!-- Table -->
	<div class="flex-1 min-h-0 overflow-auto rounded-lg border border-border/30">
		<!-- Header -->
		<div
			class="flex items-center gap-1 px-2 py-1 bg-muted/20 border-b border-border/20 sticky top-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground/50"
		>
			{#each columns as col (col.id)}
				<button
					type="button"
					class={cn("flex items-center gap-0.5 hover:text-foreground transition-colors", col.class)}
					onclick={() => handleSort(col.id)}
				>
					{col.label}
					{#if state.sortColumn === col.id}
						{#if state.sortDirection === "asc"}
							<IconArrowUp class="size-2.5" />
						{:else}
							<IconArrowDown class="size-2.5" />
						{/if}
					{:else}
						<IconSelector class="size-2.5 opacity-30" />
					{/if}
				</button>
			{/each}
			<div class="w-7 shrink-0"></div>
		</div>

		<!-- Rows -->
		{#if loading}
			<div class="py-6 text-center text-muted-foreground/40">{m.common_loading()}</div>
		{:else if isEmpty}
			<div class="py-6 text-center text-muted-foreground/40">{emptyMessage}</div>
		{:else if !hasResults}
			<div class="py-6 text-center text-muted-foreground/40">
				{m.settings_project_sessions_no_results()}
			</div>
		{:else}
			{#each paginatedRows as row (row.id)}
				<div
					class="flex items-center gap-1 px-2 py-1 border-b border-border/10 hover:bg-muted/20 transition-colors group"
				>
					<span class="flex-[2] min-w-0 truncate font-medium text-foreground/80" title={row.title}>
						{row.title || "Untitled"}
					</span>
					<div class="flex-1 min-w-0 flex items-center gap-1">
						<div
							class="size-1.5 rounded-full shrink-0"
							style="background-color: {row.projectColor}"
						></div>
						<span class="truncate text-muted-foreground" title={row.projectName}>
							{row.projectName}
						</span>
					</div>
					<span class="w-20 truncate text-muted-foreground">
						{titleCase(row.agentId)}
					</span>
					<span class="w-10 text-right text-muted-foreground/60 tabular-nums">
						{row.entryCount}
					</span>
					<span class="w-20 text-right text-muted-foreground/60 tabular-nums">
						{formatDate(row.updatedAt)}
					</span>
					<div
						class="w-7 shrink-0 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity"
					>
						<ActionsCell
							sessionId={row.id}
							projectPath={row.projectPath}
							agentId={row.agentId}
							{onView}
							{onOpenInFinder}
							{onArchive}
							{onUnarchive}
						/>
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Footer -->
	<div class="flex items-center justify-between shrink-0 text-xs">
		<span class="text-muted-foreground/50">
			{m.settings_project_sessions_count({ count: filteredCount, total: totalCount })}
		</span>
		{#if totalPages > 1}
			<div class="flex items-center gap-0.5">
				<button
					type="button"
					class="size-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 transition-all"
					disabled={!canGoPrevious}
					onclick={() => state.goToFirstPage()}
				>
					<IconChevronsLeft class="size-3" />
				</button>
				<button
					type="button"
					class="size-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 transition-all"
					disabled={!canGoPrevious}
					onclick={() => state.goToPreviousPage()}
				>
					<IconChevronLeft class="size-3" />
				</button>
				<span class="px-1 text-muted-foreground/50 tabular-nums">
					{state.currentPage + 1}/{totalPages}
				</span>
				<button
					type="button"
					class="size-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 transition-all"
					disabled={!canGoNext}
					onclick={() => state.goToNextPage(totalPages)}
				>
					<IconChevronRight class="size-3" />
				</button>
				<button
					type="button"
					class="size-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 transition-all"
					disabled={!canGoNext}
					onclick={() => state.goToLastPage(totalPages)}
				>
					<IconChevronsRight class="size-3" />
				</button>
			</div>
		{/if}
	</div>
</div>
