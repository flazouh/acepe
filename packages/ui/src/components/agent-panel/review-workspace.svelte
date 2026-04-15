<script lang="ts">
	import { type Snippet } from "svelte";

	import ReviewWorkspaceFileList from "./review-workspace-file-list.svelte";
	import ReviewWorkspaceHeader from "./review-workspace-header.svelte";
	import type { ReviewWorkspaceFileItem } from "./types.js";

	interface Props {
		files: readonly ReviewWorkspaceFileItem[];
		selectedFileIndex?: number | null;
		content?: Snippet;
		onClose?: () => void;
		onFileSelect?: (index: number) => void;
		headerLabel: string;
		emptyStateLabel: string;
		closeButtonLabel?: string;
	}

	let {
		files,
		selectedFileIndex = null,
		content,
		onClose,
		onFileSelect,
		headerLabel,
		emptyStateLabel,
		closeButtonLabel = "Back",
	}: Props = $props();

	const showEmptyState = $derived(files.length === 0 || !content);
</script>

<div
	class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-card"
	data-testid="review-workspace"
>
	<ReviewWorkspaceHeader
		label={headerLabel}
		closeButtonLabel={closeButtonLabel}
		{onClose}
	/>

	<div class="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="review-workspace-body">
		<aside
			class="w-[280px] shrink-0 border-r border-border"
			data-testid="review-workspace-files-pane"
		>
			<ReviewWorkspaceFileList
				{files}
				selectedIndex={selectedFileIndex}
				emptyStateLabel={emptyStateLabel}
				onFileSelect={onFileSelect}
			/>
		</aside>

		<section
			class="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
			data-testid="review-workspace-content-pane"
		>
			{#if showEmptyState}
				<div
					class="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground"
					data-testid="review-workspace-content-empty"
				>
					{emptyStateLabel}
				</div>
			{:else if content}
				<div class="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="review-workspace-content">
					{@render content()}
				</div>
			{/if}
		</section>
	</div>
</div>
