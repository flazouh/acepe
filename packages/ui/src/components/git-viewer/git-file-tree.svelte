<script lang="ts">
	/**
	 * GitFileTree — Dumb, generic file tree with diff stats.
	 * Reuses the same tree-building logic as the desktop file list,
	 * stripped of context menus, Tauri, and i18n.
	 */
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import FilePlus from "phosphor-svelte/lib/FilePlus";
	import FileX from "phosphor-svelte/lib/FileX";
	import FileDashed from "phosphor-svelte/lib/FileDashed";
	import File from "phosphor-svelte/lib/File";
	import FolderSimple from "phosphor-svelte/lib/FolderSimple";
	import { SvelteSet } from "svelte/reactivity";

	import { DiffPill } from "../diff-pill/index.js";
	import { getFileIconSrc, getFallbackIconSrc, getSpecialFolderIconSrc, getFolderIconSrc } from "../../lib/file-icon/index.js";
	import { cn } from "../../lib/utils.js";
	import type { Snippet } from "svelte";

	import type { GitViewerFile } from "./types.js";
	import { buildFileTree, flattenFileTree, compactSingleChildDirs } from "./file-tree-logic.js";
	import type { FileTreeNode } from "./file-tree-logic.js";

	interface Props {
		files: GitViewerFile[];
		selectedFile: string;
		onSelect: (path: string) => void;
		iconBasePath?: string;
		/** Optional per-file action buttons rendered after the diff pill on hover. */
		rowActions?: Snippet<[{ file: GitViewerFile }]>;
		class?: string;
	}

	let { files, selectedFile, onSelect, iconBasePath, rowActions, class: className }: Props = $props();

	const useSvgIcons = $derived(Boolean(iconBasePath));
	const fallbackIconSrc = $derived(useSvgIcons ? getFallbackIconSrc(iconBasePath!) : "");
	const fallbackFolderSrc = $derived(useSvgIcons ? getFolderIconSrc(false, iconBasePath!) : "");

	function handleIconError(e: Event) {
		const img = e.target as HTMLImageElement;
		if (img) {
			img.onerror = null;
			img.src = fallbackIconSrc;
		}
	}

	function handleFolderIconError(e: Event) {
		const img = e.target as HTMLImageElement;
		if (img) {
			img.onerror = null;
			img.src = fallbackFolderSrc;
		}
	}

	// Build a lookup for diff info by path
	const diffByPath = $derived(
		new Map(files.map((f) => [f.path, f]))
	);

	// Build and compact the tree
	const tree = $derived.by(() => {
		const paths = files.map((f) => f.path);
		const raw = buildFileTree(paths);
		return compactSingleChildDirs(raw);
	});

	// Expansion state — auto-expand all directories by default
	let expandedFolders = $state(new SvelteSet<string>());
	let lastFileCount = $state(0);

	$effect(() => {
		// Re-initialize when files change
		if (files.length > 0 && files.length !== lastFileCount) {
			const allDirs = new SvelteSet<string>();
			function collectDirs(nodes: FileTreeNode[]): void {
				for (const node of nodes) {
					if (node.isDirectory) {
						allDirs.add(node.path);
						collectDirs(node.children);
					}
				}
			}
			collectDirs(tree);
			expandedFolders = allDirs;
			lastFileCount = files.length;
		}
	});

	const flatNodes = $derived(flattenFileTree(tree, expandedFolders));

	function toggleFolder(path: string): void {
		if (expandedFolders.has(path)) {
			expandedFolders.delete(path);
		} else {
			expandedFolders.add(path);
		}
	}

	function getStatusIcon(status: GitViewerFile["status"] | undefined) {
		switch (status) {
			case "added": return FilePlus;
			case "deleted": return FileX;
			case "renamed": return FileDashed;
			default: return File;
		}
	}

	function getStatusColor(status: GitViewerFile["status"] | undefined): string {
		switch (status) {
			case "added": return "text-success";
			case "deleted": return "text-destructive";
			case "renamed": return "text-warning";
			default: return "text-muted-foreground";
		}
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
						<CaretRight size={10} weight="bold" />
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
					onclick={() => onSelect(node.path)}
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
