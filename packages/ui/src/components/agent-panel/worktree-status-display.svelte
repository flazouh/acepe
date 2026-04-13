<script lang="ts">
	import Folder from "@lucide/svelte/icons/folder-open";
	import Tree from "@lucide/svelte/icons/git-branch";

	interface Props {
		mode: "worktree" | "project-root";
		primaryLabel: string;
		secondaryLabel?: string | null;
	}

	let { mode, primaryLabel, secondaryLabel = null }: Props = $props();
</script>

<div class="flex items-center gap-2 px-3 py-1.5">
	<div class={`rounded-full border px-2 py-1 ${mode === "worktree" ? "border-emerald-500/20 bg-emerald-500/10" : "border-border/60 bg-background/40"}`}>
		{#if mode === "worktree"}
			<Tree class="size-3.5 text-emerald-300" />
		{:else}
			<Folder class="size-3.5 text-muted-foreground" />
		{/if}
	</div>
	<div class="min-w-0">
		<div class="truncate text-[12px] font-medium text-foreground">{primaryLabel}</div>
		{#if secondaryLabel}
			<div class="truncate text-[11px] text-muted-foreground">{secondaryLabel}</div>
		{/if}
	</div>
</div>
