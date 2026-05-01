<script lang="ts">
	import { CaretRight } from "phosphor-svelte";
	import { CaretDown } from "phosphor-svelte";
	import { ArrowRight } from "phosphor-svelte";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import AgentToolCard from "./agent-tool-card.svelte";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import type { AgentSearchMatch, AgentToolStatus } from "./types.js";

	interface Props {
		query: string | null;
		searchPath?: string;
		files?: string[];
		resultCount?: number;
		searchMode?: "content" | "files" | "count";
		searchNumFiles?: number;
		searchNumMatches?: number;
		searchMatches?: AgentSearchMatch[];
		status?: AgentToolStatus;
		durationLabel?: string;
		iconBasePath?: string;
		/** "grep" shows Grepping/Grepped, "glob" shows Finding/Found */
		variant?: "grep" | "glob";
		findingLabel?: string;
		foundLabel?: string;
		greppingLabel?: string;
		greppedLabel?: string;
		resultCountLabel?: (count: number) => string;
		showMoreLabel?: (count: number) => string;
		showLessLabel?: string;
		ariaExpandResults?: string;
		ariaCollapseResults?: string;
	}

	let {
		query,
		searchPath,
		files = [],
		resultCount,
		searchMode,
		searchNumFiles,
		searchNumMatches,
		searchMatches = [],
		status = "done",
		durationLabel,
		iconBasePath = "",
		variant = "grep",
		findingLabel = "Finding",
		foundLabel = "Found",
		greppingLabel = "Grepping",
		greppedLabel = "Grepped",
		resultCountLabel = (count) => `${count} ${count === 1 ? "result" : "results"}`,
		showMoreLabel = (count) => `Show ${count} more`,
		showLessLabel = "Show less",
		ariaExpandResults = "Expand results",
		ariaCollapseResults = "Collapse results",
	}: Props = $props();

	let isCollapsed = $state(true);
	let showAll = $state(false);

	const COLLAPSED_LIMIT = 5;

	const isPending = $derived(status === "pending" || status === "running");
	const isDone = $derived(status === "done");
	const hasFiles = $derived(files.length > 0);
	const headerLabel = $derived(
		variant === "glob"
			? (isPending ? findingLabel : foundLabel)
			: (isPending ? greppingLabel : greppedLabel)
	);

	const displayedFiles = $derived(showAll ? files : files.slice(0, COLLAPSED_LIMIT));
	const displayedMatches = $derived(showAll ? searchMatches : searchMatches.slice(0, COLLAPSED_LIMIT));
	const hasMore = $derived(files.length > COLLAPSED_LIMIT);
	const hasMoreMatches = $derived(searchMatches.length > COLLAPSED_LIMIT);
	const hasMatches = $derived(searchMatches.length > 0);

	const resultText = $derived.by(() => {
		const count = resultCount ?? files.length;
		if (!isDone) return null;
		return resultCountLabel(count);
	});
	const metadataRows = $derived.by(() => {
		const rows: Array<{ label: string; value: string }> = [];
		if (searchPath) rows.push({ label: "Path", value: searchPath });
		if (searchMode) rows.push({ label: "Mode", value: searchMode });
		if (searchNumFiles !== undefined) rows.push({ label: "Files", value: String(searchNumFiles) });
		if (searchNumMatches !== undefined) rows.push({ label: "Matches", value: String(searchNumMatches) });
		if (resultCount !== undefined) rows.push({ label: "Result count", value: String(resultCount) });
		return rows;
	});
	const hasExpandableContent = $derived(hasFiles || hasMatches || metadataRows.length > 0);

	$effect(() => {
		isCollapsed = !isPending;
	});
</script>

<AgentToolCard>
	<!-- Header: label + query/count/duration; whole row clickable when done to expand -->
	<div class="flex items-center gap-1.5 px-2.5 py-1.5">
		<button
			type="button"
			class="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left transition-colors hover:text-foreground"
			onclick={() => { isCollapsed = !isCollapsed; }}
			aria-label={isCollapsed ? ariaExpandResults : ariaCollapseResults}
		>
			<div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm text-muted-foreground">
				<ToolHeaderLeading kind="search" {status}>{headerLabel}</ToolHeaderLeading>
				{#if resultText}
					<ArrowRight size={11} weight="bold" class="shrink-0 text-muted-foreground" />
					<span class="text-sm text-muted-foreground">{resultText}</span>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-2">
				{#if durationLabel}
					<span class="pt-0.5 font-mono text-sm text-muted-foreground/70">{durationLabel}</span>
				{/if}
				{#if hasExpandableContent}
					<CaretRight
						size={10}
						weight="bold"
						class="shrink-0 text-muted-foreground transition-transform duration-150 {isCollapsed ? '' : 'rotate-90'}"
					/>
				{/if}
			</div>
		</button>
	</div>

	{#if !isCollapsed && hasExpandableContent}
		<div class="border-t border-border px-2.5 py-2 text-sm">
			{#if query}
				<div class="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
					<span class="font-mono text-muted-foreground/70">Query</span>
					<code class="font-mono text-foreground whitespace-pre-wrap break-words">{query}</code>
				</div>
			{/if}
			{#if metadataRows.length > 0}
				<div class="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
					{#each metadataRows as row (row.label)}
						<span class="font-mono text-muted-foreground/70">{row.label}</span>
						<code class="truncate font-mono text-foreground" title={row.value}>{row.value}</code>
					{/each}
				</div>
			{/if}

			{#if hasMatches}
				<div class="table-wrapper max-h-56 overflow-auto rounded border border-border/60">
					<table class="w-full border-collapse text-sm">
						<thead class="sticky top-0">
							<tr>
								<th class="px-2 py-1 text-left font-mono text-muted-foreground/80">File</th>
								<th class="px-2 py-1 text-left font-mono text-muted-foreground/80">Line</th>
								<th class="px-2 py-1 text-left font-mono text-muted-foreground/80">Kind</th>
								<th class="px-2 py-1 text-left font-mono text-muted-foreground/80">Content</th>
							</tr>
						</thead>
						<tbody>
							{#each displayedMatches as match, i (`${match.filePath}:${match.lineNumber}:${i}`)}
								<tr class="border-t border-border/40">
									<td class="px-2 py-1">
										<FilePathBadge
											filePath={match.filePath}
											fileName={match.fileName}
											{iconBasePath}
											interactive={false}
										/>
									</td>
									<td class="px-2 py-1 font-mono text-muted-foreground">{match.lineNumber}</td>
									<td class="px-2 py-1 font-mono text-muted-foreground">
										{match.isMatch ? "match" : "context"}
									</td>
									<td class="px-2 py-1 font-mono text-foreground whitespace-pre-wrap break-words">
										{match.content}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if hasFiles}
				<div class="table-wrapper max-h-56 overflow-auto rounded border border-border/60">
					<table class="w-full border-collapse text-sm">
						<thead class="sticky top-0">
							<tr>
								<th class="px-2 py-1 text-left font-mono text-muted-foreground/80">File</th>
							</tr>
						</thead>
						<tbody>
							{#each displayedFiles as filePath, i (`${filePath}:${i}`)}
								<tr class="border-t border-border/40">
									<td class="px-2 py-1">
										<FilePathBadge
											{filePath}
											{iconBasePath}
											interactive={false}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if hasMore || hasMoreMatches}
				<div class="flex justify-center pt-1">
					<button
						type="button"
						onclick={() => { showAll = !showAll; }}
						class="flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground border-none bg-transparent cursor-pointer"
					>
						{#if !showAll}
							<CaretDown size={10} weight="bold" />
							<span>{showMoreLabel((hasMatches ? searchMatches.length : files.length) - COLLAPSED_LIMIT)}</span>
						{:else}
							<CaretRight size={10} weight="bold" class="rotate-270" />
							<span>{showLessLabel}</span>
						{/if}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</AgentToolCard>

<style>
	.table-wrapper {
		background: color-mix(in srgb, var(--input) 30%, transparent);
	}

	.table-wrapper table {
		width: 100%;
		min-width: max-content;
		border-collapse: collapse;
		font-size: 0.875rem;
		line-height: 1.4;
	}

	.table-wrapper thead {
		background: color-mix(in srgb, var(--muted) 30%, transparent);
	}

	.table-wrapper th {
		padding: 0.5rem 0.75rem;
		text-align: left;
		font-weight: 500;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground);
		border-bottom: 1px solid var(--border);
		border-right: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		white-space: nowrap;
	}

	.table-wrapper th:last-child {
		border-right: none;
	}

	.table-wrapper td {
		padding: 0.4rem 0.75rem;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		border-right: 1px solid color-mix(in srgb, var(--border) 30%, transparent);
		color: var(--foreground);
	}

	.table-wrapper td:last-child {
		border-right: none;
	}

	.table-wrapper tbody tr:last-child td {
		border-bottom: none;
	}

	.table-wrapper tbody tr:hover {
		background: color-mix(in srgb, var(--muted) 15%, transparent);
	}
</style>
