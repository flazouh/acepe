<script lang="ts">
import { RoundedIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import type { SessionSummary } from "$lib/acp/application/dto/session-summary.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
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
	emptyMessage = "No sessions yet",
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

function titleCase(s: string): string {
	return s
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

const selectedProjectLabel = $derived.by(() => {
	if (!state.projectFilter) {
		return "All projects";
	}
	for (const project of uniqueProjects) {
		if (project.path === state.projectFilter) {
			return project.name;
		}
	}
	return "All projects";
});

const selectedAgentLabel = $derived(
	state.agentFilter ? titleCase(state.agentFilter) : "All agents"
);

function handleProjectFilterChange(value: string): void {
	state.setProjectFilter(value.length > 0 ? value : null);
}

function handleAgentFilterChange(value: string): void {
	state.setAgentFilter(value.length > 0 ? value : null);
}

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
</script>

<div class={cn("flex flex-col gap-2 h-full min-h-0 text-[13px]", className)}>
	<!-- Filters -->
	<div class="flex shrink-0 items-center gap-2 border-b border-border/30 pb-2">
		<div class="relative min-w-0 flex-1">
			<RoundedIcon
				name="search"
				class="absolute left-0 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50"
			/>
			<input
				type="text"
				placeholder={"Search sessions..."}
				value={state.searchQuery}
				oninput={(e) => state.setSearchQuery(e.currentTarget.value)}
				class="h-7 w-full border-0 bg-transparent pl-5 pr-2 text-[13px] outline-none placeholder:text-muted-foreground/40"
			/>
		</div>
		<Selector
			align="end"
			variant="ghost"
			triggerSize="minimal"
			class="max-w-[140px] shrink-0"
			triggerClass="max-w-[140px] text-[12px] text-muted-foreground"
			triggerAriaLabel="Filter by project"
		>
			{#snippet renderButton()}
				<span class="truncate">{selectedProjectLabel}</span>
			{/snippet}

			<DropdownMenu.RadioGroup
				value={state.projectFilter ?? ""}
				onValueChange={handleProjectFilterChange}
			>
				<DropdownMenu.RadioItem value="">All projects</DropdownMenu.RadioItem>
				{#each uniqueProjects as project (project.path)}
					<DropdownMenu.RadioItem value={project.path}>{project.name}</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</Selector>
		<Selector
			align="end"
			variant="ghost"
			triggerSize="minimal"
			class="max-w-[120px] shrink-0"
			triggerClass="max-w-[120px] text-[12px] text-muted-foreground"
			triggerAriaLabel="Filter by agent"
		>
			{#snippet renderButton()}
				<span class="truncate">{selectedAgentLabel}</span>
			{/snippet}

			<DropdownMenu.RadioGroup
				value={state.agentFilter ?? ""}
				onValueChange={handleAgentFilterChange}
			>
				<DropdownMenu.RadioItem value="">All agents</DropdownMenu.RadioItem>
				{#each uniqueAgents as agent (agent)}
					<DropdownMenu.RadioItem value={agent}>{titleCase(agent)}</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</Selector>
	</div>

	<!-- Table -->
	<div class="min-h-0 flex-1 overflow-auto">
		<!-- Header -->
		<div
			class="sticky top-0 flex h-8 items-center gap-1 border-b border-border/30 bg-popover text-[12px] font-medium text-muted-foreground"
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
							<RoundedIcon name="arrow-up" class="size-2.5" />
						{:else}
							<RoundedIcon name="arrow-up" class="size-2.5 rotate-180" />
						{/if}
					{:else}
						<span
							class="inline-flex size-2.5 flex-col items-center justify-center opacity-30"
							data-testid="session-table-unsorted-sort-icon"
							aria-hidden="true"
						>
							<RoundedIcon name="chevron-up" class="size-2" />
							<RoundedIcon name="chevron-down" class="-mt-1 size-2" />
						</span>
					{/if}
				</button>
			{/each}
			<div class="w-7 shrink-0"></div>
		</div>

		<!-- Rows -->
		{#if loading}
			<div class="py-6 text-center text-[12px] text-muted-foreground/40">{"Loading..."}</div>
		{:else if isEmpty}
			<div class="py-6 text-center text-[12px] text-muted-foreground/40">{emptyMessage}</div>
		{:else if !hasResults}
			<div class="py-6 text-center text-[12px] text-muted-foreground/40">
				{"No results found"}
			</div>
		{:else}
			{#each paginatedRows as row (row.id)}
				<div
					class="group flex h-8 items-center gap-1 border-b border-border/30 text-[13px] transition-colors hover:bg-accent/40"
				>
					<span class="flex-[2] min-w-0 truncate font-medium text-foreground" title={row.title}>
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
					<span class="w-10 text-right text-muted-foreground tabular-nums">
						{row.entryCount ?? "-"}
					</span>
					<span class="w-20 text-right text-muted-foreground tabular-nums">
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
	<div class="flex items-center justify-between shrink-0 text-[12px]">
		<span class="text-muted-foreground">
			{`Showing ${filteredCount} of ${totalCount} sessions`}
		</span>
		{#if totalPages > 1}
			<div class="flex items-center gap-0.5">
				<button
					type="button"
					class="size-5 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 transition-all"
					disabled={!canGoPrevious}
					aria-label="First page"
					title="First page"
					onclick={() => state.goToFirstPage()}
				>
					<RoundedIcon name="dist-dmzwhx2o--10-previous" class="size-3 shrink-0" />
				</button>
				<button
					type="button"
					class="size-5 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 transition-all"
					disabled={!canGoPrevious}
					onclick={() => state.goToPreviousPage()}
				>
					<RoundedIcon name="chevron-left" class="size-3 shrink-0" />
				</button>
				<span class="px-1 text-muted-foreground tabular-nums">
					{state.currentPage + 1}/{totalPages}
				</span>
				<button
					type="button"
					class="size-5 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 transition-all"
					disabled={!canGoNext}
					onclick={() => state.goToNextPage(totalPages)}
				>
					<RoundedIcon name="chevron-right" class="size-3 shrink-0" />
				</button>
				<button
					type="button"
					class="size-5 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 transition-all"
					disabled={!canGoNext}
					aria-label="Last page"
					title="Last page"
					onclick={() => state.goToLastPage(totalPages)}
				>
					<RoundedIcon name="dist-dmzwhx2o--10-next" class="size-3 shrink-0" />
				</button>
			</div>
		{/if}
	</div>
</div>
