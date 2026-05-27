<script lang="ts">
	import { CaretDown } from "phosphor-svelte";
	import { untrack } from "svelte";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import AgentToolCard from "./agent-tool-card.svelte";
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
	import type { AgentToolStatus } from "./types.js";

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
		/** Optional source range label (e.g. "12-48") */
		sourceRangeLabel?: string | null;
		/** Lines added (from git diff stats) */
		additions?: number;
		/** Lines removed (from git diff stats) */
		deletions?: number;
		/** Tool status */
		status?: AgentToolStatus;
		/** Optional elapsed label shown in the header (e.g. "for 2.34s") */
		durationLabel?: string;
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
		sourceRangeLabel = null,
		additions = 0,
		deletions = 0,
		status = "done",
		durationLabel,
		iconBasePath = "",
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
	const hasSourceExcerptHtml = $derived(hasReadSourceExcerptHtml(sourceExcerptHtml));
	const hasSourceBody = $derived(hasReadSourceBody({ sourceRangeLabel, sourceExcerpt }));
	const storageKey = $derived(getReadExpansionStorageKey({ toolCallId, filePath }));
	let isExpanded = $state(untrack(() => readPersistedReadExpanded(storageKey)));

	function toggleExpanded() {
		const next = !isExpanded;
		isExpanded = next;
		writePersistedReadExpanded(storageKey, next);
	}
</script>

<AgentToolCard>
	<div role="group" class="flex h-6 items-center justify-between pl-2 pr-1.5 text-sm">
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
						{onSelect}
					/>
				{/if}
			</div>
		</div>
		{#if durationLabel}
			<span class="ml-1.5 shrink-0 font-sans text-xs text-muted-foreground/70">
				{durationLabel}
			</span>
		{/if}
		{#if sourceExcerpt}
			<button
				type="button"
				onclick={toggleExpanded}
				class="ml-1 flex shrink-0 items-center justify-center rounded-md border-none bg-transparent p-0.5 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 active:scale-95"
				aria-label={isExpanded ? ariaCollapseSource : ariaExpandSource}
				aria-expanded={isExpanded}
			>
				<CaretDown
					weight="fill"
					size={9}
					class="transition-transform duration-150 {isExpanded ? '' : '-rotate-90'}"
				/>
			</button>
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
				{#if hasSourceExcerptHtml}
					<pre class="read-source read-source-shiki read-source-expanded"><code>{@html sourceExcerptHtml}</code></pre>
				{:else}
					<pre class="read-source read-source-expanded">{sourceExcerpt}</pre>
				{/if}
			{/if}
		</div>
	{/if}
</AgentToolCard>

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
