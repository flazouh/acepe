<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";

	interface Props {
		mode: "worktree" | "project-root";
		primaryLabel: string;
		secondaryLabel?: string | null;
	}

	let { mode, primaryLabel, secondaryLabel = null }: Props = $props();
</script>

<div class="flex items-center gap-1.5 px-3 py-1">
	{#if mode === "worktree"}
		<HugeiconsIcon name="worktree" class="size-3 shrink-0 text-success" />
	{:else}
		<HugeiconsIcon name="folder" class="size-3 shrink-0 text-muted-foreground" />
	{/if}
	<span class="truncate text-sm font-medium text-foreground">{primaryLabel}</span>
	{#if secondaryLabel}
		<span class="truncate text-sm text-muted-foreground">{secondaryLabel}</span>
	{/if}
</div>
