<script lang="ts">
	/**
	 * CheckpointFileRow - A single file row in a checkpoint file list.
	 * Uses the exact same Tailwind classes as the desktop app.
	 *
	 * This is a "dumb" component - all data and actions are passed via props.
	 */
	import { CaretRight } from 'phosphor-svelte';
	import { LoadingIcon } from '../icons/index.js';
	import { slide } from 'svelte/transition';
	import { PillButton } from '../pill-button/index.js';
	import { RevertIcon } from '../icons/index.js';
	import TextShimmer from '../text-shimmer/text-shimmer.svelte';
	import { DiffPill } from '../diff-pill/index.js';
	import type { CheckpointFile, FileDiff } from './types.js';
	import type { Snippet } from 'svelte';

	interface Props {
		file: CheckpointFile;
		isDiffExpanded?: boolean;
		isLoadingDiff?: boolean;
		isReverting?: boolean;
		diff?: FileDiff | null;
		showRevertButton?: boolean;
		/** When true, revert button is always visible (not just on hover) */
		alwaysShowRevert?: boolean;
		/** Label for the revert button. When omitted, only the icon is shown. */
		revertLabel?: string;
		allowDiffExpand?: boolean;
		onToggleDiff?: () => void;
		onRevert?: () => void;
		/** When provided, renders the full file display (e.g. FilePathBadge chip). When omitted, fileIcon+name+diff are rendered separately. */
		fileDisplay?: Snippet<[{ file: CheckpointFile }]>;
		/** Icon only - used when fileDisplay is not provided. */
		fileIcon?: Snippet<[{ filePath: string }]>;
		/** When provided and diff exists, renders the expanded diff content (e.g. pierre diffs). When omitted, falls back to plain pre. */
		diffContent?: Snippet<[{ diff: FileDiff }]>;
	}

	let {
		file,
		isDiffExpanded = false,
		isLoadingDiff = false,
		isReverting = false,
		diff = null,
		showRevertButton = true,
		alwaysShowRevert = false,
		revertLabel,
		allowDiffExpand = false,
		onToggleDiff,
		onRevert,
		fileDisplay,
		fileIcon,
		diffContent
	}: Props = $props();

	function getFileName(filePath: string): string {
		return filePath.split('/').pop() ?? filePath;
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function handleRowClick() {
		if (allowDiffExpand && onToggleDiff) {
			onToggleDiff();
		}
	}

	function handleRevertClick(e: MouseEvent) {
		e.stopPropagation();
		onRevert?.();
	}
</script>

<div>
	<!-- File row matching desktop exactly: gap-1.5, py-0.5, px-1.5, rounded, hover:bg-muted/30 -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="flex items-center justify-between gap-1.5 py-0.5 px-1.5 rounded
			   hover:bg-muted/30 group transition-colors
			   {allowDiffExpand ? 'cursor-pointer' : ''}"
		role={allowDiffExpand ? 'button' : undefined}
		tabindex={allowDiffExpand ? 0 : undefined}
		onclick={allowDiffExpand ? handleRowClick : undefined}
		onkeydown={allowDiffExpand ? (e) => e.key === 'Enter' && handleRowClick() : undefined}
	>
		<div class="flex items-center gap-1.5 min-w-0 flex-1">
			{#if allowDiffExpand}
				<CaretRight
					class="h-2.5 w-2.5 text-muted-foreground shrink-0 transition-transform duration-150
						   {isDiffExpanded ? 'rotate-90' : ''}"
					weight="bold"
				/>
			{/if}

			{#if fileDisplay}
				{@render fileDisplay({ file })}
			{:else}
				{#if fileIcon}
					{@render fileIcon({ filePath: file.filePath })}
				{/if}

				<span class="text-[10px] font-medium text-muted-foreground truncate" title={file.filePath}>
					{getFileName(file.filePath)}
				</span>

				{#if file.linesAdded !== null || file.linesRemoved !== null}
					<DiffPill insertions={file.linesAdded ?? 0} deletions={file.linesRemoved ?? 0} />
				{:else if file.fileSize !== undefined}
					<span class="text-[9px] text-muted-foreground shrink-0">
						{formatFileSize(file.fileSize)}
					</span>
				{/if}
			{/if}
		</div>

		{#if showRevertButton}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div role="group" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
				{#if isReverting}
					<PillButton variant="invert" size="xs" disabled>
						<LoadingIcon class="h-2 w-2 text-background" />
						<TextShimmer class="text-[10px]">Reverting…</TextShimmer>
					</PillButton>
				{:else}
					<PillButton variant="invert" size="xs" onclick={handleRevertClick}>
						{#snippet trailingIcon()}
							<RevertIcon size="xs" />
						{/snippet}
						{#if revertLabel}
							<span>{revertLabel}</span>
						{/if}
					</PillButton>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Expanded diff content -->
	{#if isDiffExpanded}
		<div
			class="mt-1 border border-border/30 rounded bg-card overflow-hidden"
			transition:slide={{ duration: 150 }}
		>
			{#if isLoadingDiff}
				<div class="flex items-center justify-center gap-1.5 py-3 text-[10px] text-muted-foreground">
					<LoadingIcon class="h-3 w-3" />
					<span>Loading...</span>
				</div>
			{:else if diff}
				{#if diffContent}
					{@render diffContent({ diff })}
				{:else}
					<pre class="m-0 p-2 font-mono text-[10px] leading-relaxed text-foreground/90 overflow-x-auto whitespace-pre">{diff.content}</pre>
				{/if}
			{:else}
				<div class="p-2 text-[10px] text-muted-foreground text-center italic">
					No content available
				</div>
			{/if}
		</div>
	{/if}
</div>
