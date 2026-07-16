<script lang="ts">
	import { untrack } from "svelte";
	import { Button } from "../button/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import {
		readPersistedReadExpanded,
		writePersistedReadExpanded,
	} from "./agent-tool-read-effects.js";
	import {
		getReadExpansionStorageKey,
		getReadFileName,
		getReadHeaderLabel,
		hasReadSourceBody,
		hasReadSourceExcerptHtml,
	} from "./agent-tool-read-state.js";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import type { AgentToolStatus } from "./types.js";
	import type { AgentSourceHighlighter } from "./types.js";

	interface Props {
		/** Stable tool id used to persist collapsed/expanded state */
		toolCallId?: string | null;
		/** File path being read */
		filePath?: string | null;
		/** File name (extracted from filePath if not provided) */
		fileName?: string | null;
		/** Optional provider-supplied excerpt for rich read displays */
		sourceExcerpt?: string | null;
		/** Optional Shiki-highlighted source excerpt HTML */
		sourceExcerptHtml?: string | null;
		/** Lazily highlights source when the collapsed read body is expanded */
		highlightSource?: AgentSourceHighlighter | null;
		/** Optional source range label (e.g. "12-48") */
		sourceRangeLabel?: string | null;
		/** Lines added (from git diff stats) */
		additions?: number;
		/** Lines removed (from git diff stats) */
		deletions?: number;
		/** Tool status */
		status?: AgentToolStatus;
		/** Optional elapsed label shown in the header (e.g. "for 2.34s") */
		durationTiming?: ToolDurationTiming;
		/** Base path for file type SVG icons (e.g. "/svgs/icons") */
		iconBasePath?: string;
		/** Whether clicking the file should be interactive */
		interactive?: boolean;
		/** Callback when file badge is clicked */
		onSelect?: () => void;
		/** Aria label to collapse read content */
		ariaCollapseSource?: string;
		/** Aria label to expand read content */
		ariaExpandSource?: string;
		/** Label when tool is running (e.g. "Reading") */
		runningLabel?: string;
		/** Label when tool is done (e.g. "Read") */
		doneLabel?: string;
	}

	let {
		toolCallId = null,
		filePath,
		fileName: propFileName,
		sourceExcerpt = null,
		sourceExcerptHtml = null,
		highlightSource = null,
		sourceRangeLabel = null,
		additions = 0,
		deletions = 0,
		status = "done",
		durationTiming,
		iconBasePath = "/svgs/icons",
		interactive = false,
		onSelect,
		ariaCollapseSource = "Collapse read content",
		ariaExpandSource = "Expand read content",
		runningLabel = "Reading",
		doneLabel = "Read",
	}: Props = $props();

	const headerLabel = $derived(
		getReadHeaderLabel(status, { runningLabel, doneLabel })
	);
	const derivedFileName = $derived(
		getReadFileName({ filePath, fileName: propFileName })
	);
	const resolvedSourceExcerptHtml = $derived.by(() => {
		if (!isExpanded) {
			return sourceExcerptHtml;
		}
		if (hasReadSourceExcerptHtml(sourceExcerptHtml)) {
			return sourceExcerptHtml;
		}
		if (!sourceExcerpt || highlightSource === null) {
			return null;
		}
		return highlightSource(sourceExcerpt, filePath);
	});
	const hasResolvedSourceExcerptHtml = $derived(hasReadSourceExcerptHtml(resolvedSourceExcerptHtml));
	const hasSourceBody = $derived(hasReadSourceBody({ sourceRangeLabel, sourceExcerpt }));
	const storageKey = $derived(getReadExpansionStorageKey({ toolCallId, filePath }));
	let isExpanded = $state(untrack(() => readPersistedReadExpanded(storageKey)));

	function toggleExpanded() {
		const next = !isExpanded;
		isExpanded = next;
		writePersistedReadExpanded(storageKey, next);
	}
</script>

<div class="agent-tool-read min-w-0 max-w-full overflow-hidden text-sm" data-testid="agent-tool-read">
	<div role="group" class="flex h-6 items-center justify-between gap-1.5 pl-2 pr-0.5 text-sm">
		<div class="flex min-w-0 flex-1 items-center gap-1">
			<div class="flex min-w-0 items-center gap-1">
				<ToolHeaderLeading kind="read" {status}>
					{headerLabel}
				</ToolHeaderLeading>

				{#if filePath}
					<FilePathBadge
						{filePath}
						fileName={derivedFileName}
						linesAdded={additions}
						linesRemoved={deletions}
						{iconBasePath}
						{interactive}
						variant="plain"
						{onSelect}
					/>
				{/if}
			</div>
		</div>
		<AgentToolDurationLabel
			timing={durationTiming}
			class="ml-1.5 shrink-0 font-sans text-xs"
		/>
		{#if sourceExcerpt}
			<Button
				variant="ghost"
				size="icon-sm"
				data-header-control
				class="text-muted-foreground"
				onclick={toggleExpanded}
				aria-label={isExpanded ? ariaCollapseSource : ariaExpandSource}
				aria-expanded={isExpanded}
				title={isExpanded ? ariaCollapseSource : ariaExpandSource}
			>
				{#snippet children()}
					<HugeiconsIcon
						name="chevron-down"
						class="transition-transform duration-150 {isExpanded ? '' : '-rotate-90'}"
					/>
				{/snippet}
			</Button>
		{/if}
	</div>
	{#if hasSourceBody && isExpanded}
		<div class="border-t border-border bg-muted/15">
			{#if sourceRangeLabel}
				<div class="px-2.5 py-1 font-sans text-xs text-muted-foreground/70">
					{sourceRangeLabel}
				</div>
			{/if}
			{#if sourceExcerpt}
				{#if hasResolvedSourceExcerptHtml}
					<pre class="read-source read-source-shiki read-source-expanded"><code>{@html resolvedSourceExcerptHtml}</code></pre>
				{:else}
					<pre class="read-source read-source-expanded">{sourceExcerpt}</pre>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.read-source {
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding: 0.375rem 0.625rem;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
		font-size: 0.6875rem;
		line-height: 1.45;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		margin: 0;
	}

	.read-source-expanded {
		max-height: 180px;
	}

	.read-source code {
		font: inherit;
	}

	.read-source-shiki :global(.line) {
		display: block;
		min-height: 1.45em;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 0.6875rem;
		line-height: 1.45;
	}

	.read-source-shiki {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.read-source-shiki code {
		display: block;
		font-size: 0;
		line-height: 0;
	}

	.read-source-shiki :global(span) {
		color: var(--shiki-light);
	}

	:global(.dark) .read-source-shiki :global(span) {
		color: var(--shiki-dark);
	}
</style>
