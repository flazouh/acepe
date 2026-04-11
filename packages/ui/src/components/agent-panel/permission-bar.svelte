<script lang="ts">
	import type { Snippet } from "svelte";

	import { FilePathBadge } from "../file-path-badge/index.js";

	interface Props {
		verb: string;
		filePath?: string | null;
		command?: string | null;
		showFilePath?: boolean;
		leading: Snippet;
		progress?: Snippet;
		actionBar: Snippet;
		editPreview?: Snippet;
	}

	let {
		verb,
		filePath = null,
		command = null,
		showFilePath = true,
		leading,
		progress,
		actionBar,
		editPreview,
	}: Props = $props();
</script>

<div class="w-full">
	<div
		class="w-full flex flex-col gap-1.5 px-3 py-1 rounded-md border border-border bg-muted/30 permission-card-enter {command ? 'rounded-b-none border-b-0' : ''}"
	>
		<div class="flex w-full items-start justify-between gap-1.5">
			<div class="flex min-w-0 w-full items-center gap-1.5 text-[0.6875rem]">
				<span class="inline-flex shrink-0 items-center justify-center" aria-label={verb} title={verb}>
					{@render leading()}
				</span>
				<span class="shrink-0 text-[10px] font-medium text-muted-foreground">{verb}</span>
				{#if filePath && showFilePath}
					<div class="min-w-0 flex-1 cursor-pointer">
						<FilePathBadge {filePath} interactive={false} />
					</div>
				{/if}
			</div>

			{#if progress}
				<div class="permission-tally-bar flex shrink-0 items-center self-center">
					{@render progress()}
				</div>
			{/if}
		</div>

		<div class="flex w-full items-center">
			{@render actionBar()}
		</div>

		{#if editPreview}
			<div class="overflow-hidden rounded-md border border-border/60 bg-background/60">
				{@render editPreview()}
			</div>
		{/if}
	</div>

	{#if command}
		<div class="max-h-[72px] overflow-y-auto rounded-b-md border border-border border-t-0 bg-muted/30 px-2 py-0.5">
			<code class="block min-w-0 whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/70">
				$ {command}
			</code>
		</div>
	{/if}
</div>

<style>
	.permission-card-enter {
		animation: slideUp 0.2s ease-out;
	}

	.permission-tally-bar {
		min-height: 1rem;
	}

	.permission-tally-bar :global(.voice-download-progress.compact) {
		gap: 2px;
	}

	.permission-tally-bar :global(.voice-download-segments) {
		grid-auto-columns: 3px;
		gap: 2px;
		height: 9px;
	}

	.permission-tally-bar :global(.voice-download-segment) {
		width: 3px;
		height: 9px;
		border-radius: 1.5px;
	}

	.permission-tally-bar :global(.voice-download-segment-vertical:not(.filled)) {
		height: 6px;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
