<script lang="ts">
	import type { ReviewWorkspaceFileItem } from "./types.js";

	import {
		createReviewWorkspaceTreeModel,
		type ReviewWorkspaceTreeModel,
	} from "./review-workspace-tree-model.js";
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
	}

	let {
		files,
		selectedIndex = null,
		emptyStateLabel,
		onFileSelect,
		onFileRevert,
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

		return [
			{
				id: "discard-review-file",
				label: "Discard changes",
				title: "Discard changes",
				iconText: "Undo",
				destructive: true,
				onSelect: () => onFileRevert(fileEntry.index),
			},
		];
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
