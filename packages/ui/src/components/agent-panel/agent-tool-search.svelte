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

	let isExpanded = $state(false);
	let showAll = $state(false);

	const COLLAPSED_LIMIT = 5;

	function escapeHtml(value: string): string {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function splitQuerySegments(value: string): string[] {
		const segments: string[] = [];
		let current = "";
		let inCharacterClass = false;
		let escaped = false;

		for (const character of value) {
			if (escaped) {
				current += `\\${character}`;
				escaped = false;
				continue;
			}

			if (character === "\\") {
				escaped = true;
				continue;
			}

			if (character === "[") {
				inCharacterClass = true;
				current += character;
				continue;
			}

			if (character === "]") {
				inCharacterClass = false;
				current += character;
				continue;
			}

			if (!inCharacterClass && (character === "|" || character === "\n" || character === "\r")) {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				continue;
			}

			current += character;
		}

		if (escaped) {
			current += "\\";
		}

		const trimmed = current.trim();
		if (trimmed) segments.push(trimmed);
		return segments.length > 0 ? segments : [" "];
	}

	function highlightQuerySegment(segment: string): string {
		return escapeHtml(segment).replace(
			/([()[\]{}+*?.^$|\\])/g,
			'<span class="search-query-token">$1</span>'
		);
	}

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
	const hasExpandableContent = $derived(hasFiles || hasMatches);
	const resultAreaClass = $derived(
		isExpanded ? "search-results-expanded" : "search-results-collapsed"
	);
	const querySegments = $derived(
		query
			? splitQuerySegments(query).map((segment) => ({
					raw: segment,
					html: highlightQuerySegment(segment),
				}))
			: []
	);
</script>

<AgentToolCard>
	<!-- Row 1: status + result summary + duration + caret; row 2: query (always when present, including collapsed) -->
	<div class="flex flex-col gap-0.5 px-2 py-1">
		<button
			type="button"
			class="flex min-w-0 w-full items-center justify-between gap-1.5 border-0 bg-transparent p-0 text-left transition-colors {hasExpandableContent ? 'cursor-pointer hover:text-foreground' : 'cursor-default'}"
			onclick={() => {
				if (!hasExpandableContent) return;
				isExpanded = !isExpanded;
			}}
			aria-label={hasExpandableContent ? (isExpanded ? ariaCollapseResults : ariaExpandResults) : undefined}
			aria-expanded={hasExpandableContent ? isExpanded : undefined}
		>
			<div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm text-muted-foreground">
				<ToolHeaderLeading kind="search" {status}>{headerLabel}</ToolHeaderLeading>
				{#if resultText}
					<ArrowRight size={10} weight="bold" class="shrink-0 text-muted-foreground" />
					<span class="text-xs text-muted-foreground">{resultText}</span>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-1.5">
				{#if durationLabel}
					<span class="font-sans text-xs text-muted-foreground/70">{durationLabel}</span>
				{/if}
				{#if hasExpandableContent}
					<CaretRight
						size={9}
						weight="bold"
						class="shrink-0 text-muted-foreground transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
					/>
				{/if}
			</div>
		</button>
		{#if query}
			<div class="search-query-block">
				{#each querySegments as segment, index}
					<pre class="search-query-line"><span class="search-query-line-number">{index + 1}</span><code>{@html segment.html}</code></pre>
				{/each}
			</div>
		{/if}
	</div>

	{#if hasExpandableContent}
		<div
			class="search-results-area {resultAreaClass}"
			role="button"
			tabindex="0"
			onclick={() => {
				if (!isExpanded) isExpanded = true;
			}}
			onkeydown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				isExpanded = !isExpanded;
			}}
		>
			{#if hasMatches}
				<div class="search-result-list">
					{#each displayedMatches as match, i (`${match.filePath}:${match.lineNumber}:${i}`)}
						<div class="search-result-row" class:search-result-context={!match.isMatch}>
							<div class="search-result-file">
								<FilePathBadge
									filePath={match.filePath}
									fileName={match.fileName}
									{iconBasePath}
									interactive={false}
								/>
								<span class="search-result-line">:{match.lineNumber}</span>
							</div>
							<pre class="search-result-content">{match.content}</pre>
						</div>
					{/each}
				</div>
			{:else if hasFiles}
				<div class="search-result-list">
					{#each displayedFiles as filePath, i (`${filePath}:${i}`)}
						<div class="search-file-row">
							<FilePathBadge
								{filePath}
								{iconBasePath}
								interactive={false}
							/>
						</div>
					{/each}
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
	.search-query-block {
		margin-top: 0.125rem;
		max-height: 7.5rem;
		overflow: auto;
		border-top: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
		padding: 0.25rem 0.375rem 0;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--foreground);
	}

	.search-query-block code {
		font: inherit;
		min-width: 0;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.search-query-line {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		column-gap: 0.375rem;
		margin: 0;
		font: inherit;
		line-height: inherit;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.search-query-line-number {
		user-select: none;
		min-width: 1ch;
		text-align: right;
		color: color-mix(in srgb, var(--muted-foreground) 55%, transparent);
		border-right: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
		padding-right: 0.375rem;
	}

	.search-query-line :global(.search-query-token) {
		color: color-mix(in srgb, var(--primary) 82%, var(--foreground));
	}

	.search-results-area {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: color-mix(in srgb, var(--card) 80%, var(--muted));
		border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
		padding: 0.375rem 0.5rem;
		overflow-y: auto;
		outline: none;
	}

	.search-results-collapsed {
		max-height: 5.5rem;
		cursor: pointer;
	}

	.search-results-expanded {
		max-height: 17.5rem;
	}

	.search-result-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.search-result-row,
	.search-file-row {
		min-width: 0;
		border-radius: 0.25rem;
		background: color-mix(in srgb, var(--muted) 28%, transparent);
		padding: 0.25rem 0.375rem;
	}

	.search-result-context {
		opacity: 0.72;
	}

	.search-result-file {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.25rem;
	}

	.search-result-line {
		flex-shrink: 0;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
		font-size: 0.6875rem;
		color: color-mix(in srgb, var(--muted-foreground) 75%, transparent);
	}

	.search-result-content {
		margin: 0.25rem 0 0;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
		font-size: 0.75rem;
		line-height: 1.4;
		white-space: pre-wrap;
		word-break: break-word;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
	}
</style>
