<script lang="ts">
	import { type Snippet } from "svelte";

	import ReviewWorkspaceFileList from "./review-workspace-file-list.svelte";
	import ReviewWorkspaceHeader from "./review-workspace-header.svelte";
	import type { ReviewWorkspaceFileItem } from "./types.js";

	import { DiffPill } from "../diff-pill/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";

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
		/**
		 * Flat surface: drop the boxed `bg-input/30` pane cards in favour of the
		 * Source Control modal's flush, hairline-divider treatment. The host dialog
		 * already owns the surface, so the panes fill it transparently and are
		 * separated by a single `border-r` rather than floating as rounded cards.
		 */
		flat?: boolean;
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
		flat = false,
	}: Props = $props();

	const showEmptyState = $derived(files.length === 0 || !content);
	const selectedFileItem = $derived(
		typeof selectedFileIndex === "number" && selectedFileIndex >= 0
			? (files[selectedFileIndex] ?? null)
			: null
	);
	// Flush (Source Control) mode replaces the boxed pane cards with a per-file
	// header band over the diff and a gutter on the diff body, so the code is not
	// jammed against the divider. Only when the host hides the workspace header.
	const showFlatFileHeader = $derived(flat && !showHeader && !showEmptyState && selectedFileItem !== null);
	const filesPaneWidth = $derived(compact ? "w-[220px]" : "w-[280px]");
	const rootClass = $derived(
		flat
			? "flex h-full min-h-0 flex-1 w-full min-w-0 flex-col overflow-hidden"
			: compact
				? "flex h-full min-h-0 flex-1 w-full min-w-0 flex-col gap-1 overflow-hidden"
				: "flex h-full min-h-0 flex-1 w-full min-w-0 flex-col gap-2 overflow-hidden"
	);
	const bodyClass = $derived(
		flat
			? "flex min-h-0 min-w-0 flex-1 overflow-hidden"
			: compact
				? "flex min-h-0 min-w-0 flex-1 gap-1 overflow-hidden"
				: "flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden"
	);
	const filesPaneClass = $derived(
		flat
			? `flex min-h-0 ${filesPaneWidth} shrink-0 flex-col overflow-hidden border-r border-border/30`
			: `flex min-h-0 ${filesPaneWidth} shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-input/30`
	);
	const contentPaneClass = $derived(
		flat
			? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
			: compact
				? "flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden"
				: "flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden"
	);
	const contentCardClass = $derived(
		flat
			? `flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${showHeader ? "p-2" : ""}`
			: compact
				? `flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden ${showHeader ? "p-1" : ""}`
				: `flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden ${showHeader ? "p-2" : ""}`
	);
	const codeCardClass = $derived(
		flat
			? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
			: "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-input/30"
	);
	// Diff body gutter: flush mode pads the code so line numbers clear the divider.
	const codeBodyClass = $derived(
		flat
			? "flex h-0 min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2"
			: "flex h-0 min-h-0 flex-1 flex-col overflow-hidden"
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
						{#if showFlatFileHeader && selectedFileItem}
							<div
								class="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2"
								data-testid="review-workspace-flat-file-header"
							>
								<FilePathBadge
									filePath={selectedFileItem.filePath}
									fileName={selectedFileItem.fileName ?? undefined}
									interactive={false}
									class="!bg-transparent !border-transparent !px-0 min-w-0"
								/>
								{#if selectedFileItem.additions > 0 || selectedFileItem.deletions > 0}
									<DiffPill
										insertions={selectedFileItem.additions}
										deletions={selectedFileItem.deletions}
										variant="plain"
									/>
								{/if}
							</div>
						{/if}
						<div
							class={codeBodyClass}
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
