<script lang="ts">
	import { CaretRight } from "phosphor-svelte";
	import { CaretDown } from "phosphor-svelte";
	import ToolLabel from "./tool-label.svelte";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		query: string | null;
		searchPath?: string;
		files?: string[];
		resultCount?: number;
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
	const hasMore = $derived(files.length > COLLAPSED_LIMIT);

	const resultText = $derived.by(() => {
		const count = resultCount ?? files.length;
		if (!isDone) return null;
		return resultCountLabel(count);
	});

	$effect(() => {
		isCollapsed = !isPending;
	});
</script>

<!-- No card: when streaming show content; when done show summary only, click to expand -->
<div class="flex min-w-0 flex-1 flex-col">
	<!-- Header: label + query/count/duration; whole row clickable when done to expand -->
	<div class="flex items-start gap-1.5">
		<button
			type="button"
			class="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-2 border-0 bg-transparent p-0 text-left transition-colors hover:text-foreground"
			onclick={() => { isCollapsed = !isCollapsed; }}
			aria-label={isCollapsed ? ariaExpandResults : ariaCollapseResults}
		>
			<div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm text-muted-foreground">
				<ToolLabel {status}>{headerLabel}</ToolLabel>
				{#if query}
					<code class="min-w-0 max-w-[200px] truncate rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground" title={query}>
						{query}
					</code>
					{#if resultText}
						<span class="text-muted-foreground/80">·</span>
						<span class="font-mono text-[10px] text-muted-foreground/80">{resultText}</span>
					{/if}
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-2">
				{#if durationLabel}
					<span class="pt-0.5 font-mono text-[10px] text-muted-foreground/70">{durationLabel}</span>
				{/if}
				{#if hasFiles}
					<CaretRight
						size={10}
						weight="bold"
						class="shrink-0 text-muted-foreground transition-transform duration-150 {isCollapsed ? '' : 'rotate-90'}"
					/>
				{/if}
			</div>
		</button>
	</div>

	<!-- Body: file list only when expanded (or when streaming) -->
	{#if !isCollapsed && hasFiles}
		<div class="flex flex-col text-xs">
			{#each displayedFiles as filePath, i (i)}
				<div class="py-px">
					<FilePathBadge
						{filePath}
						{iconBasePath}
						interactive={false}
					/>
				</div>
			{/each}
			{#if hasMore}
				<div class="flex justify-center pt-0.5 pb-px">
					<button
						type="button"
						onclick={() => { showAll = !showAll; }}
						class="flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground border-none bg-transparent cursor-pointer"
					>
						{#if !showAll}
							<CaretDown size={10} weight="bold" />
							<span>{showMoreLabel(files.length - COLLAPSED_LIMIT)}</span>
						{:else}
							<CaretRight size={10} weight="bold" class="rotate-270" />
							<span>{showLessLabel}</span>
						{/if}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
