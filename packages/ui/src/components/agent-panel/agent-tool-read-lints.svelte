<script lang="ts">
	import { CaretRight } from "phosphor-svelte";

	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import { TextShimmer } from "../text-shimmer/index.js";
	import type { AgentToolStatus, LintDiagnostic } from "./types.js";

	interface Props {
		/** Tool status */
		status?: AgentToolStatus;
		/** Total number of diagnostics across all files */
		totalDiagnostics?: number;
		/** Number of files with at least one diagnostic */
		totalFiles?: number;
		/** Optional list of diagnostics for expandable detail (e.g. file, line, message) */
		diagnostics?: LintDiagnostic[] | null;
		/** Optional elapsed label (e.g. "0.2s") */
		durationLabel?: string;
		/** Label when running (e.g. "Checking lints") */
		runningLabel?: string;
		/** Label when done (e.g. "Read lints") */
		doneLabel?: string;
		/** Label when no issues (e.g. "No issues") */
		noIssuesLabel?: string;
		/** Summary template: e.g. "{count} issues in {files} files" */
		summaryLabel?: string;
		/** Aria label for collapse button */
		ariaCollapse?: string;
		/** Aria label for expand button */
		ariaExpand?: string;
	}

	let {
		status = "done",
		totalDiagnostics = 0,
		totalFiles = 0,
		diagnostics = null,
		durationLabel,
		runningLabel = "Checking lints",
		doneLabel = "Read lints",
		noIssuesLabel = "No issues",
		summaryLabel = "{count} issues in {files} files",
		ariaCollapse = "Collapse lint results",
		ariaExpand = "Expand lint results",
	}: Props = $props();

	const isPending = $derived(status === "pending" || status === "running");
	const labelText = $derived.by(() => {
		if (status === "blocked") return "Blocked";
		if (status === "degraded") return "Degraded";
		if (status === "cancelled") return "Cancelled";
		if (status === "error") return "Lint check failed";
		if (isPending) return runningLabel;
		return doneLabel;
	});
	const hasContent = $derived(
		!isPending && (totalDiagnostics > 0 || totalFiles > 0 || (diagnostics?.length ?? 0) > 0)
	);
	// summaryLabel is pre-formatted from desktop (includes count/files); use as-is when we have content
	const summaryText = $derived.by(() => {
		if (totalDiagnostics === 0 && totalFiles === 0) {
			return noIssuesLabel;
		}
		return summaryLabel;
	});

	let isExpanded = $state(true);

	function toggleExpand() {
		isExpanded = !isExpanded;
	}

	function expand() {
		isExpanded = true;
	}

	const displayDiagnostics = $derived(
		Array.isArray(diagnostics) && diagnostics.length > 0 ? diagnostics : null
	);
</script>

<AgentToolCard>
	<!-- Header: same fixed height as edit card -->
	<div role="group" class="flex h-7 items-center justify-between pl-2.5 pr-2 text-sm">
		<div class="flex min-w-0 flex-1 items-center gap-2 truncate">
			<ToolHeaderLeading kind="read_lints" {status}>
				{labelText}
			</ToolHeaderLeading>
			{#if isPending}
				<TextShimmer class="text-muted-foreground" duration={1.2}>
					<span class="truncate">Read Lints</span>
				</TextShimmer>
			{:else}
				<span class="min-w-0 truncate text-muted-foreground">Read Lints</span>
			{/if}
		</div>

		{#if durationLabel || (!isPending && hasContent)}
			<div class="ml-2 flex shrink-0 items-center gap-2">
				{#if durationLabel}
					<span class="font-mono text-sm text-muted-foreground/70">{durationLabel}</span>
				{/if}
				{#if !isPending && hasContent}
					<button
						type="button"
						onclick={toggleExpand}
						class="flex items-center justify-center rounded-sm border-none bg-transparent p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
						aria-label={isExpanded ? ariaCollapse : ariaExpand}
						aria-expanded={isExpanded}
					>
						<CaretRight
							size={10}
							weight="bold"
							class="text-muted-foreground transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
						/>
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Expandable content: summary + optional diagnostics list -->
	{#if hasContent && isExpanded}
		<div class="border-t border-border px-2.5 py-2">
			<p class="text-sm text-muted-foreground">{summaryText}</p>
			{#if displayDiagnostics}
				<ul class="mt-2 space-y-1.5 text-sm">
					{#each displayDiagnostics as diag, i (i)}
						<li class="flex flex-col gap-0.5 rounded border border-border/60 bg-muted/20 px-2 py-1.5">
							{#if diag.filePath}
								<span class="font-mono text-muted-foreground">{diag.filePath}</span>
							{/if}
							{#if diag.line != null}
								<span class="text-muted-foreground/80">Line {diag.line}</span>
							{/if}
							{#if diag.message}
								<span class="text-foreground">{diag.message}</span>
							{/if}
							{#if diag.severity}
								<span class="text-muted-foreground/70">{diag.severity}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</AgentToolCard>
