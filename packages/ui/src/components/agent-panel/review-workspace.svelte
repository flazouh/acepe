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
		onFileRevert?: (index: number) => void;
		headerLabel: string;
		emptyStateLabel: string;
		closeButtonLabel?: string;
		showHeader?: boolean;
		showCloseButton?: boolean;
		compact?: boolean;
	}

	let {
		files,
		selectedFileIndex = null,
		content,
		onClose,
		onFileSelect,
		onFileRevert,
		headerLabel,
		emptyStateLabel,
		closeButtonLabel = "Back",
		showHeader = true,
		showCloseButton = true,
		compact = false,
	}: Props = $props();

	const showEmptyState = $derived(files.length === 0 || !content);
	const rootClass = $derived(
		compact
			? "flex h-full min-h-0 w-full min-w-0 flex-col gap-1 overflow-hidden"
			: "flex h-full min-h-0 w-full min-w-0 flex-col gap-2 overflow-hidden"
	);
	const bodyClass = $derived(
		compact
			? "flex min-h-0 min-w-0 flex-1 gap-1 overflow-hidden"
			: "flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden"
	);
	const filesPaneClass = $derived(
		compact
			? "flex min-h-0 w-[220px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-input/30"
			: "flex min-h-0 w-[280px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-input/30"
	);
	const contentPaneClass = $derived(
		compact
			? "flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden"
			: "flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden"
	);
	const contentCardClass = $derived(
		compact
			? `flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden ${showHeader ? "p-1" : ""}`
			: `flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden ${showHeader ? "p-2" : ""}`
	);
	const codeCardClass = $derived(
		compact
			? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-input/30"
			: "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-input/30"
	);

	function handlePreviousFile(): void {
		if (selectedFileIndex === null || selectedFileIndex <= 0) {
			return;
		}

		onFileSelect?.(selectedFileIndex - 1);
	}

	function handleNextFile(): void {
		if (selectedFileIndex === null || selectedFileIndex >= files.length - 1) {
			return;
		}

		onFileSelect?.(selectedFileIndex + 1);
	}
</script>

<div
	class={rootClass}
	data-testid="review-workspace"
>
	<div class={bodyClass} data-testid="review-workspace-body">
		<aside
			class={filesPaneClass}
			data-testid="review-workspace-files-pane"
		>
			<ReviewWorkspaceFileList
				{files}
				selectedIndex={selectedFileIndex}
				emptyStateLabel={emptyStateLabel}
				onFileSelect={onFileSelect}
				onFileRevert={onFileRevert}
			/>
		</aside>

		<section
			class={contentPaneClass}
			data-testid="review-workspace-content-pane"
		>
			<div class={contentCardClass} data-testid="review-workspace-content">
				{#if showHeader}
					<ReviewWorkspaceHeader
						label={headerLabel}
						closeButtonLabel={closeButtonLabel}
						fileCount={files.length}
						{selectedFileIndex}
						{showCloseButton}
						{onClose}
						onPreviousFile={handlePreviousFile}
						onNextFile={handleNextFile}
					/>
				{/if}

				{#if showEmptyState}
					<div
						class={codeCardClass + " items-center justify-center px-6 text-center text-sm text-muted-foreground"}
						data-testid="review-workspace-content-empty"
					>
						{emptyStateLabel}
					</div>
				{:else if content}
					<div class={codeCardClass} data-testid="review-workspace-code-card">
						<div
							class="flex h-full min-h-0 flex-1 overflow-hidden"
							data-testid="review-workspace-code-scroll-shell"
						>
							{@render content()}
						</div>
					</div>
				{/if}
			</div>
		</section>
	</div>
</div>
