<script lang="ts">
	/**
	 * CheckpointTimeline - A timeline of checkpoints.
	 * Uses the exact same Tailwind classes as the desktop app.
	 *
	 * This is a "dumb" component - all data and actions are passed via props.
	 */
	import { ArrowLeft } from 'phosphor-svelte';
	import { LoadingIcon } from '../icons/index.js';
	import type { Snippet } from 'svelte';
	import { Button } from '../button/index.js';
	import CheckpointCard from './checkpoint-card.svelte';
	import type { CheckpointData, CheckpointFile, CheckpointState, FileRowState } from './types.js';

	interface Props {
		checkpoints: CheckpointData[];
		checkpointStates?: Map<string, CheckpointState>;
		fileStates?: Map<string, FileRowState>;
		isLoading?: boolean;
		showBackButton?: boolean;
		showRevertButtons?: boolean;
		alwaysShowRevert?: boolean;
		fileRevertLabel?: string;
		allowFileDiffExpand?: boolean;
		backLabel?: string;
		loadingMessage?: string;
		emptyMessage?: string;
		onBack?: () => void;
		onToggleCheckpoint?: (checkpointId: string) => void;
		onRevertClick?: (checkpointId: string) => void;
		onRevertConfirm?: (checkpointId: string) => void;
		onRevertCancel?: (checkpointId: string) => void;
		onToggleFileDiff?: (checkpointId: string, fileId: string) => void;
		onRevertFile?: (checkpointId: string, fileId: string, filePath: string) => void;
		fileDisplay?: Snippet<[{ file: CheckpointFile }]>;
		fileIcon?: Snippet<[{ filePath: string }]>;
	}

	let {
		checkpoints,
		checkpointStates = new Map(),
		fileStates = new Map(),
		isLoading = false,
		showBackButton = false,
		showRevertButtons = true,
		alwaysShowRevert = false,
		fileRevertLabel,
		allowFileDiffExpand = false,
		backLabel = 'Back',
		loadingMessage = 'Loading checkpoints...',
		emptyMessage = 'No checkpoints yet',
		onBack,
		onToggleCheckpoint,
		onRevertClick,
		onRevertConfirm,
		onRevertCancel,
		onToggleFileDiff,
		onRevertFile,
		fileDisplay,
		fileIcon
	}: Props = $props();

	// Filter out checkpoints with no files and reverse so oldest is at top
	const visibleCheckpoints = $derived(
		[...checkpoints.filter((cp) => cp.fileCount > 0)].reverse()
	);

	function getCheckpointState(checkpointId: string): CheckpointState {
		return (
			checkpointStates.get(checkpointId) ?? {
				isExpanded: true,
				isLoadingFiles: false,
				isReverting: false,
				files: []
			}
		);
	}

	// Track confirmation state locally since it's UI-only
	let confirmingCheckpointId = $state<string | null>(null);
</script>

<div class="flex flex-col h-full">
	<!-- Header with back button -->
	{#if showBackButton && onBack}
		<div class="flex items-center px-3 py-2">
			<Button
				variant="ghost"
				size="sm"
				class="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
				onclick={onBack}
			>
				<ArrowLeft class="h-3.5 w-3.5" weight="bold" />
				<span class="text-xs">{backLabel}</span>
			</Button>
		</div>
	{/if}

	<!-- Content - scrollable list, centered like main content -->
	<div class="flex-1 overflow-y-auto flex justify-center">
		<div class="w-full max-w-4xl">
			{#if isLoading}
				<div class="flex items-center justify-center h-24 text-muted-foreground text-sm">
					<LoadingIcon class="h-4 w-4 mr-2" />
					{loadingMessage}
				</div>
			{:else if visibleCheckpoints.length === 0}
				<div class="flex items-center justify-center h-24 text-muted-foreground text-xs">
					{emptyMessage}
				</div>
			{:else}
				<!-- Simple list with gap - reversed so oldest (first) is at top -->
				<div class="p-2 space-y-1">
					{#each visibleCheckpoints as checkpoint (checkpoint.id)}
						{@const state = getCheckpointState(checkpoint.id)}
						<CheckpointCard
							{checkpoint}
							files={state.files}
							{fileStates}
							isExpanded={state.isExpanded}
							isLoadingFiles={state.isLoadingFiles}
							isReverting={state.isReverting}
							isConfirming={confirmingCheckpointId === checkpoint.id}
							showRevertButton={showRevertButtons}
							{alwaysShowRevert}
							{fileRevertLabel}
							{allowFileDiffExpand}
							{fileDisplay}
							{fileIcon}
							onToggleExpand={() => onToggleCheckpoint?.(checkpoint.id)}
							onRevertClick={() => {
								confirmingCheckpointId = checkpoint.id;
								onRevertClick?.(checkpoint.id);
							}}
							onRevertConfirm={() => {
								confirmingCheckpointId = null;
								onRevertConfirm?.(checkpoint.id);
							}}
							onRevertCancel={() => {
								confirmingCheckpointId = null;
								onRevertCancel?.(checkpoint.id);
							}}
							onToggleFileDiff={(fileId) => onToggleFileDiff?.(checkpoint.id, fileId)}
							onRevertFile={(fileId, filePath) => onRevertFile?.(checkpoint.id, fileId, filePath)}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
