<script lang="ts">
	/**
	 * GitStatusList — Staged and unstaged file sections with collapsible headers.
	 * Uses GitFileTree for tree-organized file display within each section.
	 */
	import PlusIcon from "../icons/plus-icon.svelte";
	import { HugeiconsIcon } from "../icons/index.js";

	import { cn } from "../../lib/utils.js";
	import type { GitStatusFile } from "./types.js";
	import GitFileTree from "../git-viewer/git-file-tree.svelte";
	import type { GitViewerFile } from "../git-viewer/types.js";
	import type { PierreFileTreeRowAction } from "../pierre-tree/index.js";

	const EMPTY_ACTIONS: readonly PierreFileTreeRowAction[] = [];

	interface Props {
		stagedFiles: GitStatusFile[];
		unstagedFiles: GitStatusFile[];
		iconBasePath?: string;
		onStage?: (path: string) => void;
		onUnstage?: (path: string) => void;
		onStageAll?: () => void;
		onDiscard?: (path: string) => void;
		/** Callback when a file is selected (for showing diff). Receives file metadata and whether the file is staged. */
		onFileSelect?: (file: GitViewerFile, staged: boolean) => void;
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

	function stagedRowActions(file: GitViewerFile): readonly PierreFileTreeRowAction[] {
		if (!onUnstage) {
			return EMPTY_ACTIONS;
		}

		return [
			{
				id: "unstage",
				label: "Unstage file",
				iconText: "-",
				onSelect: () => onUnstage(file.path),
			},
		];
	}

	function unstagedRowActions(file: GitViewerFile): readonly PierreFileTreeRowAction[] {
		const actions: PierreFileTreeRowAction[] = [];

		if (onStage) {
			actions.push({
				id: "stage",
				label: "Stage file",
				iconText: "+",
				onSelect: () => onStage(file.path),
			});
		}

		if (onDiscard) {
			actions.push({
				id: "discard",
				label: "Discard changes",
				iconText: "!",
				destructive: true,
				onSelect: () => onDiscard(file.path),
			});
		}

		return actions;
	}
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
					<HugeiconsIcon name="chevron-right" class="size-3" />
				</span>
				Staged Changes
				<span class="font-normal text-muted-foreground">({stagedFiles.length})</span>
			</button>

			{#if stagedExpanded}
				<GitFileTree
					files={stagedViewerFiles}
					{selectedFile}
					onSelect={(file) => onFileSelect?.(file, true)}
					{iconBasePath}
					rowActions={stagedRowActions}
					class="overflow-visible bg-transparent"
				/>
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
						<HugeiconsIcon name="chevron-right" class="size-3" />
					</span>
					Changes
					<span class="font-normal text-muted-foreground">({unstagedFiles.length})</span>
				</button>

				{#if onStageAll}
					<button
						type="button"
						class="mr-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-success/10 hover:text-success"
						title="Stage all changes"
						onclick={onStageAll}
					>
						<PlusIcon />
					</button>
				{/if}
			</div>

			{#if unstagedExpanded}
				<GitFileTree
					files={unstagedViewerFiles}
					{selectedFile}
					onSelect={(file) => onFileSelect?.(file, false)}
					{iconBasePath}
					rowActions={unstagedRowActions}
					class="overflow-visible bg-transparent"
				/>
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
