<script lang="ts">
	/**
	 * CheckpointCard - A single checkpoint in a timeline.
	 * Uses the exact same Tailwind classes as the desktop app.
	 *
	 * This is a "dumb" component - all data and actions are passed via props.
	 */
	import { CaretRight } from 'phosphor-svelte';
	import { LoadingIcon } from '../icons/index.js';
	import { slide } from 'svelte/transition';
	import type { Snippet } from 'svelte';
	import { PillButton } from '../pill-button/index.js';
	import { RevertIcon } from '../icons/index.js';
	import TextShimmer from '../text-shimmer/text-shimmer.svelte';
	import { DiffPill } from '../diff-pill/index.js';
	import CheckpointFileList from './checkpoint-file-list.svelte';
	import type { CheckpointData, CheckpointFile, FileDiff, FileRowState } from './types.js';

	interface Props {
		checkpoint: CheckpointData;
		files?: CheckpointFile[];
		fileStates?: Map<string, FileRowState>;
		isExpanded?: boolean;
		isLoadingFiles?: boolean;
		isReverting?: boolean;
		isConfirming?: boolean;
		showRevertButton?: boolean;
		/** When true, revert buttons are always visible (not just on hover) */
		alwaysShowRevert?: boolean;
		allowFileDiffExpand?: boolean;
		revertLabel?: string;
		/** Label for file-level revert buttons. When omitted, only the icon is shown. */
		fileRevertLabel?: string;
		cancelLabel?: string;
		confirmLabel?: string;
		loadingFilesMessage?: string;
		onToggleExpand?: () => void;
		onRevertClick?: () => void;
		onRevertConfirm?: () => void;
		onRevertCancel?: () => void;
		onToggleFileDiff?: (fileId: string) => void;
		onRevertFile?: (fileId: string, filePath: string) => void;
		fileDisplay?: Snippet<[{ file: CheckpointFile }]>;
		fileIcon?: Snippet<[{ filePath: string }]>;
		diffContent?: Snippet<[{ diff: FileDiff }]>;
	}

	let {
		checkpoint,
		files = [],
		fileStates = new Map(),
		isExpanded = false,
		isLoadingFiles = false,
		isReverting = false,
		isConfirming = false,
		showRevertButton = true,
		alwaysShowRevert = false,
		allowFileDiffExpand = false,
		revertLabel = 'Revert All',
		fileRevertLabel,
		cancelLabel = 'Cancel',
		confirmLabel = 'Confirm',
		loadingFilesMessage = 'Loading files...',
		onToggleExpand,
		onRevertClick,
		onRevertConfirm,
		onRevertCancel,
		onToggleFileDiff,
		onRevertFile,
		fileDisplay,
		fileIcon,
		diffContent
	}: Props = $props();

	const hasDiffStats = $derived(
		checkpoint.totalInsertions !== null || checkpoint.totalDeletions !== null
	);

	function formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<div class="rounded-md border border-border/50 bg-muted/50 overflow-hidden">
	<button
		type="button"
		class="group w-full flex h-6 items-center justify-between pl-1 pr-2 text-xs
			   hover:bg-muted/80 transition-colors"
		onclick={onToggleExpand}
	>
		<!-- Left side: Badge + message -->
		<div class="flex items-center gap-1.5 min-w-0 flex-1">
			<span
				class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0"
			>
				{checkpoint.number}
			</span>
			<span class="text-[11px] text-foreground/90 truncate">
				<span class="text-muted-foreground">
					{checkpoint.message ?? formatTimestamp(checkpoint.timestamp)}
				</span>
			</span>
		</div>

		<!-- Right side: Diff (plain) + Revert + Chevron -->
		<div class="flex items-center gap-1.5 shrink-0 ml-2">
			{#if hasDiffStats}
				<DiffPill
					insertions={checkpoint.totalInsertions ?? 0}
					deletions={checkpoint.totalDeletions ?? 0}
					variant="plain"
				/>
			{:else}
				<span class="text-[10px] text-muted-foreground font-mono">
					{checkpoint.fileCount}
					{checkpoint.fileCount === 1 ? 'file' : 'files'}
				</span>
			{/if}

			{#if showRevertButton}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div role="group" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} class="opacity-50 group-hover:opacity-100 transition-opacity">
					{#if isReverting}
						<PillButton variant="invert" size="xs" disabled>
							<LoadingIcon class="h-2 w-2 text-background" />
							<TextShimmer class="text-[10px]">Reverting…</TextShimmer>
						</PillButton>
					{:else if isConfirming}
						<div class="flex items-center gap-1">
							<PillButton variant="invert" size="xs" onclick={onRevertCancel}>
								{cancelLabel}
							</PillButton>
							<PillButton variant="invert" size="xs" onclick={onRevertConfirm}>
								{confirmLabel}
							</PillButton>
						</div>
					{:else}
						<PillButton variant="invert" size="xs" onclick={onRevertClick}>
							{#snippet trailingIcon()}
								<RevertIcon size="xs" />
							{/snippet}
							<span>{revertLabel}</span>
						</PillButton>
					{/if}
				</div>
			{/if}
			<CaretRight
				class="h-2.5 w-2.5 text-muted-foreground shrink-0 transition-transform duration-150
					   {isExpanded ? 'rotate-90' : ''}"
				weight="bold"
			/>
		</div>
	</button>

	{#if isExpanded}
		<div transition:slide={{ duration: 150 }} class="border-t border-border/30">
			{#if isLoadingFiles}
				<div class="flex items-center justify-center py-2 text-muted-foreground text-[10px]">
					<LoadingIcon class="h-3 w-3 mr-1.5" />
					{loadingFilesMessage}
				</div>
			{:else}
				<CheckpointFileList
					{files}
					{fileStates}
					showRevertButtons={showRevertButton}
					{alwaysShowRevert}
					revertLabel={fileRevertLabel}
					allowDiffExpand={allowFileDiffExpand}
					{fileDisplay}
					{fileIcon}
					{diffContent}
					{onToggleFileDiff}
					{onRevertFile}
				/>
			{/if}
		</div>
	{/if}
</div>
