<script lang="ts">
	import { FilePathBadge } from "../file-path-badge/index.js";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		/** File path being read */
		filePath?: string | null;
		/** File name (extracted from filePath if not provided) */
		fileName?: string | null;
		/** Optional provider-supplied excerpt for rich read displays */
		sourceExcerpt?: string | null;
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
		/** Label when tool is running (e.g. "Reading") */
		runningLabel?: string;
		/** Label when tool is done (e.g. "Read") */
		doneLabel?: string;
	}

	let {
		filePath,
		fileName: propFileName,
		sourceExcerpt = null,
		sourceRangeLabel = null,
		additions = 0,
		deletions = 0,
		status = "done",
		durationLabel,
		iconBasePath = "",
		interactive = false,
		onSelect,
		runningLabel = "Reading",
		doneLabel = "Read",
	}: Props = $props();

	const isPending = $derived(status === "pending" || status === "running");
	const derivedFileName = $derived(
		propFileName ?? (filePath ? (filePath.split("/").pop() ?? filePath) : null)
	);
</script>

<!-- Mirrors desktop tool-call-read.svelte visual structure -->
<div>
	<div class="flex items-start gap-1.5">
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<div class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
				<ToolHeaderLeading kind="read" {status}>
					{#if isPending}
						{runningLabel}
					{:else}
						{doneLabel}
					{/if}
				</ToolHeaderLeading>

				<!-- File chip with diff stats -->
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
					<span class="shrink-0 pt-0.5 font-mono text-sm text-muted-foreground/70">
				{durationLabel}
			</span>
		{/if}
	</div>
	{#if sourceRangeLabel || sourceExcerpt}
		<div class="mt-1.5 space-y-1 pl-5">
			{#if sourceRangeLabel}
				<div class="font-mono text-sm text-muted-foreground/70">{sourceRangeLabel}</div>
			{/if}
			{#if sourceExcerpt}
				<pre class="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2 py-1 text-sm text-muted-foreground">{sourceExcerpt}</pre>
			{/if}
		</div>
	{/if}
</div>
