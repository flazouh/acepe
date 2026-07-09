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
	<div class="flex-1 overflow-y-auto overflow-x-hidden py-1">
		{#each flatNodes as node (node.path)}
			{@const diff = diffByPath.get(node.path)}
			{@const isActive = selectedFile === node.path}
			{@const isExpanded = expandedFolders.has(node.path)}

			{#if node.isDirectory}
				<!-- Directory row -->
				<button
					type="button"
					class={cn(
						"w-full flex items-center gap-1 px-2 py-0.5 text-left transition-colors cursor-pointer",
						"text-muted-foreground hover:bg-muted/40 hover:text-foreground"
					)}
					style="padding-left: {node.depth * 12 + 8}px"
					onclick={() => toggleFolder(node.path)}
				>
					<span
						class="flex h-3.5 w-3.5 shrink-0 items-center justify-center transition-transform duration-150"
						class:rotate-90={isExpanded}
					>
						<CaretRight size={12} weight="regular"  class="size-3"/>
					</span>
					{#if useSvgIcons}
						<img
							src={getSpecialFolderIconSrc(node.name, isExpanded, iconBasePath!)}
							alt=""
							class="h-3.5 w-3.5 shrink-0 object-contain"
							aria-hidden="true"
							onerror={handleFolderIconError}
						/>
					{:else}
						<FolderSimple size={14} weight={isExpanded ? "fill" : "regular"} class="shrink-0 text-muted-foreground" />
					{/if}
					<span class="truncate text-[0.6875rem] font-medium">{node.name}</span>
				</button>
			{:else}
				<!-- File row -->
				{@const StatusIcon = getStatusIcon(diff?.status)}
				<button
					type="button"
					class={cn(
						"group w-full flex items-center gap-1 px-2 py-0.5 text-left transition-colors cursor-pointer",
						"border-l-2",
						isActive
							? "border-l-primary bg-muted/60 text-foreground"
							: "border-l-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
					)}
					style="padding-left: {node.depth * 12 + 8}px"
					title={`${node.path} (+${diff?.additions ?? 0} -${diff?.deletions ?? 0})`}
					onclick={() => {
						if (diff) {
							onSelect(diff);
						}
					}}
				>
					<!-- Spacer matching chevron width -->
					<span class="h-3.5 w-3.5 shrink-0"></span>
					{#if useSvgIcons}
						<img
							src={getFileIconSrc(node.name, iconBasePath!)}
							alt=""
							class="h-3.5 w-3.5 shrink-0 object-contain"
							aria-hidden="true"
							onerror={handleIconError}
						/>
					{:else}
						<span class="shrink-0 {getStatusColor(diff?.status)}">
							<StatusIcon size={14} weight="bold" />
						</span>
					{/if}
					<span class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] leading-none">
						{node.name}
					</span>
					{#if diff}
						<DiffPill
							insertions={diff.additions}
							deletions={diff.deletions}
							variant="plain"
						/>
					{/if}
					{#if rowActions && diff}
						{@render rowActions({ file: diff })}
					{/if}
				</button>
			{/if}
		{/each}
	</div>
</div>
