<script lang="ts">
	/**
	 * GitFileTree — Dumb, generic file tree with diff stats.
	 */
	import { cn } from "../../lib/utils.js";
	import { PierreFileTree } from "../pierre-tree/index.js";
	import type {
		PierreFileTreeActionItem,
		PierreFileTreeRowAction,
	} from "../pierre-tree/index.js";

	import type { GitViewerFile } from "./types.js";
	import {
		createGitFileTreeDiffDecoration,
		createGitFileTreeModel,
	} from "./git-file-tree-model.js";

	const EMPTY_ACTIONS: readonly PierreFileTreeRowAction[] = [];
	const TREE_SEARCH_CHROME_HEIGHT_PX = 36;
	const COMPACT_TREE_ROW_HEIGHT_PX = 24;
	const GIT_TREE_UNSAFE_CSS = `
		button[data-type='item'] {
			font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
			font-size: 11px;
			line-height: 16px;
			min-height: 20px;
		}

		button[data-type='item'][data-item-selected] {
			border-left: 2px solid hsl(var(--primary));
		}
	`;

	interface Props {
		files: GitViewerFile[];
		selectedFile: string;
		onSelect: (file: GitViewerFile) => void;
		iconBasePath?: string;
		/** Optional per-file actions rendered through Pierre's action menu lane. */
		rowActions?: (file: GitViewerFile) => readonly PierreFileTreeRowAction[];
		class?: string;
	}

	let { files, selectedFile, onSelect, iconBasePath, rowActions, class: className }: Props = $props();

	const treeModel = $derived(createGitFileTreeModel(files));
	const treeHeightPx = $derived(
		Math.min(
			420,
			Math.max(
				72,
				TREE_SEARCH_CHROME_HEIGHT_PX + treeModel.paths.length * COMPACT_TREE_ROW_HEIGHT_PX
			)
		)
	);
	const icons = $derived(
		iconBasePath ? ({ set: "complete", colored: true } as const) : undefined
	);

	function handleSelectionChange(selectedPaths: readonly string[]): void {
		const selectedPath = selectedPaths[selectedPaths.length - 1];
		if (!selectedPath) {
			return;
		}

		const file = treeModel.filesByPath.get(selectedPath);
		if (file) {
			onSelect(file);
		}
	}

	function resolveRowActions(item: PierreFileTreeActionItem): readonly PierreFileTreeRowAction[] {
		if (!rowActions || item.kind !== "file") {
			return EMPTY_ACTIONS;
		}

		const file = treeModel.filesByPath.get(item.path);
		if (!file) {
			return EMPTY_ACTIONS;
		}

		return rowActions(file);
	}
</script>

<div class={cn("flex flex-col overflow-hidden bg-background", className)}>
	<div class="min-h-0" style:height={`${treeHeightPx}px`}>
		<PierreFileTree
			paths={treeModel.paths}
			gitStatus={treeModel.gitStatus}
			selectedPath={selectedFile}
			revealPath={selectedFile}
			onSelectionChange={handleSelectionChange}
			rowActions={rowActions ? resolveRowActions : undefined}
			rowDecoration={(item) => {
				const file = treeModel.filesByPath.get(item.path);
				return file ? createGitFileTreeDiffDecoration(file) : null;
			}}
			contextMenuTriggerMode={rowActions ? "both" : "right-click"}
			contextMenuButtonVisibility={rowActions ? "always" : "when-needed"}
			flattenEmptyDirectories={true}
			icons={icons}
			unsafeCSS={GIT_TREE_UNSAFE_CSS}
			class="h-full bg-transparent"
			testId="git-file-tree"
			ariaLabel="Git file tree"
		/>
	</div>
</div>
