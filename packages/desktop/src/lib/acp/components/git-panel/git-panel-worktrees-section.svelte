<script lang="ts">
	import { Check, FolderOpen, GitBranch, Trash, Tree } from "phosphor-svelte";
	import type { WorktreeListItem } from "../../store/git-modal-state.js";
	import type { WorktreeInfo } from "../../types/worktree-info.js";

	interface Props {
		currentWorktree: WorktreeInfo | null;
		branch: string | null;
		projectPath: string;
		worktreeItems: WorktreeListItem[];
		/** Which delete confirmation is open: a directory, "all", or null. */
		deleteConfirm: string | "all" | null;
		onDeleteConfirmChange: (value: string | "all" | null) => void;
		onRevealPath: (path: string) => void;
		onDeleteWorktree: (directory: string) => void;
		onDeleteAllWorktrees: () => void;
	}

	let {
		currentWorktree,
		branch,
		projectPath,
		worktreeItems,
		deleteConfirm,
		onDeleteConfirmChange,
		onRevealPath,
		onDeleteWorktree,
		onDeleteAllWorktrees,
	}: Props = $props();
</script>

<div class="flex-1 min-h-0 overflow-y-auto px-2.5 py-2">
	<div class="space-y-1.5">
		<div class="flex items-center gap-2 rounded-md border border-border/40 bg-muted/15 px-2.5 py-2">
			<GitBranch size={12} weight="bold" class="shrink-0 text-muted-foreground" />
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<span class="text-[11px] font-medium text-foreground">Main repository</span>
					{#if !currentWorktree}
						<span
							class="rounded-full bg-accent px-1.5 py-px text-[9px] font-medium text-foreground"
							>Current</span
						>
					{/if}
				</div>
				<div class="flex items-center gap-2 mt-0.5">
					{#if branch}
						<span class="text-[10px] text-muted-foreground font-mono truncate">{branch}</span>
					{/if}
					<span class="text-[10px] text-muted-foreground/60 font-mono truncate">{projectPath}</span>
				</div>
			</div>
			<button
				type="button"
				class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
				title="Reveal in Finder"
				onclick={() => onRevealPath(projectPath)}
			>
				<FolderOpen size={12} weight="bold" />
			</button>
		</div>

		{#if worktreeItems.length > 0}
			<div class="flex items-center justify-between px-1 pt-1">
				<span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70"
					>Worktrees</span
				>
				{#if deleteConfirm === "all"}
					<div class="flex items-center gap-1">
						<span class="text-[10px] text-destructive">Delete all?</span>
						<button
							type="button"
							class="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
							onclick={() => onDeleteAllWorktrees()}>Yes</button
						>
						<button
							type="button"
							class="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
							onclick={() => onDeleteConfirmChange(null)}>No</button
						>
					</div>
				{:else}
					<button
						type="button"
						class="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
						title="Delete all worktrees"
						onclick={() => onDeleteConfirmChange("all")}
					>
						<Trash size={10} weight="bold" />
					</button>
				{/if}
			</div>
		{/if}
		{#if worktreeItems.length === 0}
			<div
				class="rounded-md border border-dashed border-border/50 px-2.5 py-3 text-center text-[11px] text-muted-foreground"
			>
				No linked worktrees for this repository yet.
			</div>
		{:else}
			{#each worktreeItems as item (item.worktree.directory)}
				<div
					class={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${item.isCurrent ? "border-accent/60 bg-accent/8" : "border-border/40 bg-muted/10 hover:bg-muted/20"} transition-colors`}
				>
					<Tree size={12} weight="fill" class="shrink-0 text-success" />
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<span class="text-[11px] font-medium text-foreground font-mono truncate"
								>{item.worktree.name}</span
							>
							{#if item.isCurrent}
								<span
									class="inline-flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-px text-[9px] font-medium text-foreground"
								>
									<Check size={8} weight="bold" />
									Current
								</span>
							{/if}
							{#if item.worktree.origin === "external"}
								<span class="text-[9px] uppercase tracking-wide text-muted-foreground/50">ext</span>
							{/if}
						</div>
						<div class="flex items-center gap-2 mt-px">
							<span class="text-[10px] text-muted-foreground font-mono truncate"
								>{item.worktree.branch}</span
							>
							<span class="text-[10px] text-muted-foreground/50 font-mono truncate"
								>{item.worktree.directory}</span
							>
						</div>
					</div>
					{#if deleteConfirm === item.worktree.directory}
						<div class="flex items-center gap-1 shrink-0">
							<span class="text-[10px] text-destructive">Delete?</span>
							<button
								type="button"
								class="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
								onclick={() => onDeleteWorktree(item.worktree.directory)}>Yes</button
							>
							<button
								type="button"
								class="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
								onclick={() => onDeleteConfirmChange(null)}>No</button
							>
						</div>
					{:else}
						<button
							type="button"
							class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
							title="Reveal in Finder"
							onclick={() => onRevealPath(item.worktree.directory)}
						>
							<FolderOpen size={12} weight="bold" />
						</button>
						<button
							type="button"
							class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
							title="Delete worktree"
							onclick={() => onDeleteConfirmChange(item.worktree.directory)}
						>
							<Trash size={12} weight="bold" />
						</button>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
