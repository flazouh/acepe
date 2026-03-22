<script lang="ts">
	/**
	 * GitStatusList — Staged and unstaged file sections with collapsible headers.
	 * Uses GitFileTree for tree-organized file display within each section.
	 */
	import ArrowCounterClockwise from "phosphor-svelte/lib/ArrowCounterClockwise";
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import FileMinus from "phosphor-svelte/lib/FileMinus";
	import Plus from "phosphor-svelte/lib/Plus";

	import { cn } from "../../lib/utils.js";
	import type { GitStatusFile } from "./types.js";
	import GitFileTree from "../git-viewer/git-file-tree.svelte";
	import type { GitViewerFile } from "../git-viewer/types.js";

	interface Props {
		stagedFiles: GitStatusFile[];
		unstagedFiles: GitStatusFile[];
		iconBasePath?: string;
		onStage?: (path: string) => void;
		onUnstage?: (path: string) => void;
		onStageAll?: () => void;
		onDiscard?: (path: string) => void;
		/** Callback when a file is selected (for showing diff). Receives path and whether the file is staged. */
		onFileSelect?: (path: string, staged: boolean) => void;
		/** Currently selected file path (for highlighting) */
		selectedFile?: string;
		class?: string;
	}

	let {
		stagedFiles,
		unstagedFiles,
		iconBasePath,
		onStage,
		onUnstage,
		onStageAll,
		onDiscard,
		onFileSelect,
		selectedFile = "",
		class: className,
	}: Props = $props();

	let stagedExpanded = $state(true);
	let unstagedExpanded = $state(true);

	const stagedViewerFiles = $derived<GitViewerFile[]>(
		stagedFiles.map((f) => ({
			path: f.path,
			status: (f.indexStatus ?? "modified") as GitViewerFile["status"],
			additions: f.additions,
			deletions: f.deletions,
		}))
	);

	const unstagedViewerFiles = $derived<GitViewerFile[]>(
		unstagedFiles.map((f) => ({
			path: f.path,
			status: (f.worktreeStatus === "untracked" ? "added" : f.worktreeStatus ?? "modified") as GitViewerFile["status"],
			additions: f.additions,
			deletions: f.deletions,
		}))
	);
</script>

<div class={cn("flex flex-col overflow-y-auto", className)}>
	<!-- Staged Changes -->
	{#if stagedFiles.length > 0}
		<div class="flex flex-col">
			<button
				type="button"
				class="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[0.6875rem] font-semibold text-foreground transition-colors hover:bg-muted/30"
				onclick={() => (stagedExpanded = !stagedExpanded)}
			>
				<span
					class="flex h-3.5 w-3.5 shrink-0 items-center justify-center transition-transform duration-150"
					class:rotate-90={stagedExpanded}
				>
					<CaretRight size={10} weight="bold" />
				</span>
				Staged Changes
				<span class="font-normal text-muted-foreground">({stagedFiles.length})</span>
			</button>

			{#if stagedExpanded}
				<GitFileTree
					files={stagedViewerFiles}
					{selectedFile}
					onSelect={(path) => onFileSelect?.(path, true)}
					{iconBasePath}
					class="overflow-visible bg-transparent"
				>
					{#snippet rowActions({ file })}
						<div class="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
							<button
								type="button"
								class="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-warning/10 hover:text-warning"
								title="Unstage file"
								onclick={(e) => { e.stopPropagation(); onUnstage?.(file.path); }}
							>
								<FileMinus size={12} weight="bold" />
							</button>
						</div>
					{/snippet}
				</GitFileTree>
			{/if}
		</div>
	{/if}

	<!-- Unstaged Changes -->
	{#if unstagedFiles.length > 0}
		<div class="flex flex-col">
			<div class="flex items-center">
				<button
					type="button"
					class="flex flex-1 cursor-pointer items-center gap-1.5 px-2 py-1 text-[0.6875rem] font-semibold text-foreground transition-colors hover:bg-muted/30"
					onclick={() => (unstagedExpanded = !unstagedExpanded)}
				>
					<span
						class="flex h-3.5 w-3.5 shrink-0 items-center justify-center transition-transform duration-150"
						class:rotate-90={unstagedExpanded}
					>
						<CaretRight size={10} weight="bold" />
					</span>
					Changes
					<span class="font-normal text-muted-foreground">({unstagedFiles.length})</span>
				</button>

				{#if onStageAll}
					<button
						type="button"
						class="mr-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-success/10 hover:text-success"
						title="Stage all changes"
						onclick={onStageAll}
					>
						<Plus size={12} weight="bold" />
					</button>
				{/if}
			</div>

			{#if unstagedExpanded}
				<GitFileTree
					files={unstagedViewerFiles}
					{selectedFile}
					onSelect={(path) => onFileSelect?.(path, false)}
					{iconBasePath}
					class="overflow-visible bg-transparent"
				>
					{#snippet rowActions({ file })}
						<div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
							{#if onStage}
								<button
									type="button"
									class="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-success/10 hover:text-success"
									title="Stage file"
									onclick={(e) => { e.stopPropagation(); onStage?.(file.path); }}
								>
									<Plus size={12} weight="bold" />
								</button>
							{/if}
							{#if onDiscard}
								<button
									type="button"
									class="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
									title="Discard changes"
									onclick={(e) => { e.stopPropagation(); onDiscard?.(file.path); }}
								>
									<ArrowCounterClockwise size={12} weight="bold" />
								</button>
							{/if}
						</div>
					{/snippet}
				</GitFileTree>
			{/if}
		</div>
	{/if}

	<!-- Empty state -->
	{#if stagedFiles.length === 0 && unstagedFiles.length === 0}
		<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
			No changes
		</div>
	{/if}
</div>
