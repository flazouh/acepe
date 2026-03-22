<script lang="ts">
	/**
	 * CheckpointFileList - A list of files within a checkpoint.
	 * Uses the exact same Tailwind classes as the desktop app: px-2 py-1 space-y-0.5
	 *
	 * This is a "dumb" component - all data and actions are passed via props.
	 */
	import type { Snippet } from 'svelte';
	import CheckpointFileRow from './checkpoint-file-row.svelte';
	import type { CheckpointFile, FileDiff, FileRowState } from './types.js';

	interface Props {
		files: CheckpointFile[];
		fileStates?: Map<string, FileRowState>;
		showRevertButtons?: boolean;
		alwaysShowRevert?: boolean;
		revertLabel?: string;
		allowDiffExpand?: boolean;
		onToggleFileDiff?: (fileId: string) => void;
		onRevertFile?: (fileId: string, filePath: string) => void;
		fileDisplay?: Snippet<[{ file: CheckpointFile }]>;
		fileIcon?: Snippet<[{ filePath: string }]>;
		diffContent?: Snippet<[{ diff: FileDiff }]>;
	}

	let {
		files,
		fileStates = new Map(),
		showRevertButtons = true,
		alwaysShowRevert = false,
		revertLabel,
		allowDiffExpand = false,
		onToggleFileDiff,
		onRevertFile,
		fileDisplay,
		fileIcon,
		diffContent
	}: Props = $props();

	// Filter to files with actual changes (matching desktop behavior)
	const visibleFiles = $derived(
		files.filter((f) => (f.linesAdded ?? 0) > 0 || (f.linesRemoved ?? 0) > 0)
	);

	function getFileState(fileId: string): FileRowState {
		return (
			fileStates.get(fileId) ?? {
				isDiffExpanded: false,
				isLoadingDiff: false,
				isReverting: false,
				diff: null
			}
		);
	}
</script>

<!-- Matches desktop exactly: px-2 py-1 space-y-0.5 -->
<div class="px-2 py-1 space-y-0.5">
	{#each visibleFiles as file (file.id)}
		{@const state = getFileState(file.id)}
		<CheckpointFileRow
			{file}
			isDiffExpanded={state.isDiffExpanded}
			isLoadingDiff={state.isLoadingDiff}
			isReverting={state.isReverting}
			diff={state.diff}
			showRevertButton={showRevertButtons}
			{alwaysShowRevert}
			{revertLabel}
			{allowDiffExpand}
			{fileDisplay}
			{fileIcon}
			{diffContent}
			onToggleDiff={() => onToggleFileDiff?.(file.id)}
			onRevert={() => onRevertFile?.(file.id, file.filePath)}
		/>
	{/each}
</div>
