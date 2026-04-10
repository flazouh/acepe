<script lang="ts">
	/**
	 * GitViewer — Composed layout for viewing commit/PR diffs.
	 * Dumb component: all data passed via props, diff rendering via snippet.
	 *
	 * Layout: header + (file tree sidebar | diff content area)
	 */
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";
	import type { GitCommitData, GitPrData, GitViewerFile } from "./types.js";
	import GitCommitHeader from "./git-commit-header.svelte";
	import GitPrHeader from "./git-pr-header.svelte";
	import GitFileTree from "./git-file-tree.svelte";
	import GitDiffViewToggle from "./git-diff-view-toggle.svelte";

	type ViewerData =
		| { type: "commit"; commit: GitCommitData }
		| { type: "pr"; pr: GitPrData };

	interface Props {
		data: ViewerData;
		selectedFile: string;
		viewMode: "inline" | "side-by-side";
		onSelectFile: (path: string) => void;
		onChangeViewMode: (mode: "inline" | "side-by-side") => void;
		onViewOnGitHub?: () => void;
		/** Consumer provides diff rendering for the selected file. */
		diffContent?: Snippet<[{ file: GitViewerFile; viewMode: "inline" | "side-by-side" }]>;
		/** Optional slot for the empty state when no file is selected. */
		emptyState?: Snippet;
		/** Base path for file-type SVG icons (e.g. "/svgs/icons"). Falls back to Phosphor icons if omitted. */
		iconBasePath?: string;
		class?: string;
	}

	let {
		data,
		selectedFile,
		viewMode,
		onSelectFile,
		onChangeViewMode,
		onViewOnGitHub,
		diffContent,
		emptyState,
		iconBasePath,
		class: className,
	}: Props = $props();

	const files = $derived(data.type === "commit" ? data.commit.files : data.pr.files);
	const selectedFileDiff = $derived(files.find((f) => f.path === selectedFile));
</script>

<div class={cn("flex flex-col h-full overflow-hidden", className)}>
	<!-- Header -->
	<div class="shrink-0 px-3 pt-3 pb-2">
		{#if data.type === "commit"}
			<GitCommitHeader commit={data.commit} {onViewOnGitHub} />
		{:else}
			<GitPrHeader pr={data.pr} {onViewOnGitHub} />
		{/if}
	</div>

	<!-- Body: file tree + diff -->
	<div class="flex flex-1 min-h-0 border-t border-border/30">
		<!-- File tree sidebar -->
		<GitFileTree
			{files}
			{selectedFile}
			onSelect={(file) => onSelectFile(file.path)}
			{iconBasePath}
			class="w-56 shrink-0 border-r border-border/30"
		/>

		<!-- Diff content area -->
		<div class="flex flex-col flex-1 min-w-0 overflow-hidden">
			<!-- Toolbar: view toggle -->
			<div class="flex items-center justify-between shrink-0 px-3 py-1.5 border-b border-border/30 bg-muted/20">
				{#if selectedFileDiff}
					<span class="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
						{selectedFileDiff.path}
					</span>
				{:else}
					<span></span>
				{/if}
				<GitDiffViewToggle mode={viewMode} onChange={onChangeViewMode} />
			</div>

			<!-- Diff content -->
			<div class="flex-1 overflow-auto">
				{#if selectedFileDiff && diffContent}
					{@render diffContent({ file: selectedFileDiff, viewMode })}
				{:else if emptyState}
					{@render emptyState()}
				{:else}
					<div class="flex items-center justify-center h-full text-muted-foreground text-sm">
						Select a file to view changes
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
