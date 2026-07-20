<script lang="ts">
	import type { ReviewWorkspaceFileItem } from "./types.js";

	import {
		createReviewWorkspaceTreeModel,
		createReviewWorkspaceTreeDecoration,
		type ReviewWorkspaceTreeModel,
	} from "./review-workspace-tree-model.js";
	import { DiffPill } from "../diff-pill/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import {
		PierreFileTree,
		type PierreFileTreeActionItem,
		type PierreFileTreeRowAction,
	} from "../pierre-tree/index.js";

	interface Props {
		files: readonly ReviewWorkspaceFileItem[];
		selectedIndex?: number | null;
		emptyStateLabel: string;
		onFileSelect?: (index: number) => void;
		onFileRevert?: (index: number) => void;
		onFileRevertCancel?: (index: number) => void;
		variant?: "tree" | "flat";
	}

	let {
		files,
		selectedIndex = null,
		emptyStateLabel,
		onFileSelect,
		onFileRevert,
		onFileRevertCancel,
		variant = "tree",
	}: Props = $props();

	const EMPTY_ROW_ACTIONS: readonly PierreFileTreeRowAction[] = [];
	const REVIEW_WORKSPACE_TREE_CSS = `
		[data-type="item"] {
			border-radius: 5px;
			font-size: 12px;
		}

		[data-type="item"][aria-selected="true"] {
			font-weight: 500;
		}

		[data-type="item"][data-item-kind="directory"] {
			color: hsl(var(--muted-foreground));
		}
	`;

	const treeModel: ReviewWorkspaceTreeModel = $derived(
		createReviewWorkspaceTreeModel(files, selectedIndex),
	);
	const useFlatList = $derived(variant === "flat");

	function handleTreeSelectionChange(selectedPaths: readonly string[]): void {
		const selectedPath = selectedPaths[selectedPaths.length - 1];
		if (!selectedPath) {
			return;
		}

		const selectedFile = treeModel.filesByPath.get(selectedPath);
		if (!selectedFile) {
			return;
		}

		onFileSelect?.(selectedFile.index);
	}

	function resolveTreeRowActions(
		item: PierreFileTreeActionItem,
	): readonly PierreFileTreeRowAction[] {
		if (!onFileRevert || item.kind !== "file") {
			return EMPTY_ROW_ACTIONS;
		}

		const fileEntry = treeModel.filesByPath.get(item.path);
		if (!fileEntry) {
			return EMPTY_ROW_ACTIONS;
		}
		const resetStatus = fileEntry.file.resetStatus ?? "idle";
		const isBusy = resetStatus === "resetting" || resetStatus === "reset";

		return [
			{
				id: "discard-review-file",
				label: resolveResetActionLabel(fileEntry.file),
				title: resolveResetActionLabel(fileEntry.file),
				iconText: "Undo",
				destructive: true,
				disabled: isBusy,
				onSelect: () => onFileRevert(fileEntry.index),
			},
		];
	}

	function handleFlatRevert(event: MouseEvent, index: number): void {
		event.stopPropagation();
		onFileRevert?.(index);
	}

	function handleFlatRevertCancel(event: MouseEvent, index: number): void {
		event.stopPropagation();
		onFileRevertCancel?.(index);
	}

	function handleFlatRowKeydown(event: KeyboardEvent, index: number): void {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}

		event.preventDefault();
		onFileSelect?.(index);
	}

	function resolveResetStatusLabel(file: ReviewWorkspaceFileItem): string | null {
		if (file.resetStatusLabel) {
			return file.resetStatusLabel;
		}

		if (file.resetStatus === "confirming") {
			return "Reset this file?";
		}

		if (file.resetStatus === "resetting") {
			return "Resetting";
		}

		if (file.resetStatus === "reset") {
			return "Reset";
		}

		if (file.resetStatus === "failed") {
			return "Reset failed";
		}

		return null;
	}

	function resolveResetActionLabel(file: ReviewWorkspaceFileItem): string {
		if (file.resetStatus === "confirming") {
			return "Confirm reset";
		}

		if (file.resetStatus === "resetting") {
			return "Resetting";
		}

		if (file.resetStatus === "reset") {
			return "Reset";
		}

		if (file.resetStatus === "failed") {
			return "Retry reset";
		}

		return "Discard changes";
	}

	function resolveFlatRowClass(selected: boolean, file: ReviewWorkspaceFileItem): string {
		const selectionClass = selected ? "bg-muted text-foreground" : "text-muted-foreground";

		if (file.resetStatus === "confirming") {
			return `${selectionClass} ring-1 ring-destructive/30 bg-destructive/5`;
		}

		if (file.resetStatus === "resetting") {
			return `${selectionClass} bg-muted/60`;
		}

		if (file.resetStatus === "reset") {
			return `${selectionClass} ring-1 ring-success/25 bg-success/5`;
		}

		if (file.resetStatus === "failed") {
			return `${selectionClass} ring-1 ring-destructive/30 bg-destructive/5`;
		}

		return selectionClass;
	}
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="review-workspace-file-list">
	{#if files.length === 0}
		<div
			class="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground"
			data-testid="review-workspace-file-list-empty"
		>
			{emptyStateLabel}
		</div>
	{:else if useFlatList}
		<div
			class="min-h-0 flex-1 overflow-auto p-1"
			role="listbox"
			aria-label="Review files"
			data-testid="review-workspace-flat-file-list"
		>
			<div class="flex min-w-0 flex-col gap-0.5">
				{#each files as file, index (file.id)}
					{@const selected = index === selectedIndex}
					{@const decoration = createReviewWorkspaceTreeDecoration(file)}
					{@const resetStatusLabel = resolveResetStatusLabel(file)}
					{@const resetStatus = file.resetStatus ?? "idle"}
					<div
						role="option"
						tabindex="0"
						class="group flex min-h-7 w-full min-w-0 items-center gap-2 rounded-[5px] px-2 py-1 text-left text-xs outline-none transition-colors hover:bg-muted/55 focus-visible:ring-1 focus-visible:ring-ring {resolveFlatRowClass(
							selected,
							file,
						)}"
						aria-selected={selected}
						title={decoration.title}
						data-reset-status={resetStatus}
						data-testid="review-workspace-flat-file-row"
						onclick={() => onFileSelect?.(index)}
						onkeydown={(event) => handleFlatRowKeydown(event, index)}
					>
						<span class="flex size-4 shrink-0 items-center justify-center">
							{#if file.reviewStatus === "reviewed"}
								<HugeiconsIcon name="check-circle" class="size-3 text-success" />
							{:else}
								<span class="size-2 rounded-full border border-muted-foreground/60"></span>
							{/if}
						</span>
						<span class="flex min-w-0 flex-1 flex-col">
							<FilePathBadge
								filePath={file.filePath}
								fileName={file.fileName ?? undefined}
								interactive={false}
								size="sm"
								variant="plain"
								class="min-w-0 !bg-transparent !border-transparent !px-0"
							/>
							{#if resetStatusLabel}
								<span
									class="truncate text-[10px] leading-3 {resetStatus === 'failed'
										? 'text-destructive'
										: resetStatus === 'reset'
											? 'text-success'
											: 'text-muted-foreground'} {resetStatus === 'resetting'
										? 'animate-pulse'
										: ''}"
									role="status"
									aria-live="polite"
									data-testid="review-workspace-flat-file-reset-status"
								>
									{resetStatusLabel}
								</span>
							{/if}
						</span>
						<DiffPill
							insertions={file.additions}
							deletions={file.deletions}
							variant="plain"
							class="shrink-0"
						/>
						{#if onFileRevert && resetStatus === "confirming"}
							<div
								class="flex shrink-0 items-center gap-1"
								data-testid="review-workspace-flat-file-reset-confirm"
							>
								<button
									type="button"
									class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none transition hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
									onclick={(event) => handleFlatRevertCancel(event, index)}
								>
									Cancel
								</button>
								<button
									type="button"
									class="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground outline-none transition hover:bg-destructive/90 focus-visible:ring-1 focus-visible:ring-ring"
									onclick={(event) => handleFlatRevert(event, index)}
								>
									Reset
								</button>
							</div>
						{:else if onFileRevert && resetStatus !== "resetting" && resetStatus !== "reset"}
							<button
								type="button"
								class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
								title={resolveResetActionLabel(file)}
								aria-label={resolveResetActionLabel(file)}
								data-testid="review-workspace-flat-file-revert"
								onclick={(event) => handleFlatRevert(event, index)}
							>
								<HugeiconsIcon name="undo" class="size-3" />
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-hidden p-1" data-testid="review-workspace-file-list-scroll">
			<PierreFileTree
				paths={treeModel.paths}
				selectedPath={treeModel.selectedPath}
				initialExpandedPaths={treeModel.initialExpandedPaths}
				revealPath={treeModel.selectedPath}
				onSelectionChange={handleTreeSelectionChange}
				rowDecoration={(item) => treeModel.decorationsByPath.get(item.path) ?? null}
				rowActions={onFileRevert ? resolveTreeRowActions : undefined}
				contextMenuTriggerMode="both"
				contextMenuButtonVisibility={onFileRevert ? "always" : "when-needed"}
				initialExpansion="closed"
				flattenEmptyDirectories={true}
				density="compact"
				unsafeCSS={REVIEW_WORKSPACE_TREE_CSS}
				class="h-full"
				testId="review-workspace-file-tree"
				ariaLabel="Review files"
				showControls={true}
			/>
		</div>
	{/if}
</div>
