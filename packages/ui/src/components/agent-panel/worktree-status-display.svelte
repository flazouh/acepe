<script lang="ts">
	import Folder from "@lucide/svelte/icons/folder-open";
	import { Tree } from "phosphor-svelte";

	interface Props {
		mode: "worktree" | "project-root";
		primaryLabel: string;
		secondaryLabel?: string | null;
	}

	let { mode, primaryLabel, secondaryLabel = null }: Props = $props();
</script>

<div class="flex items-center gap-1.5 px-3 py-1">
	{#if mode === "worktree"}
		<Tree size={12} weight="fill" class="shrink-0 text-success" />
	{:else}
		<Folder class="size-3 shrink-0 text-muted-foreground" />
	{/if}
	<span class="truncate text-[0.6875rem] font-medium text-foreground">{primaryLabel}</span>
	{#if secondaryLabel}
		<span class="truncate text-[0.6875rem] text-muted-foreground">{secondaryLabel}</span>
	{/if}
</div>
