<script lang="ts">
	import type { Snippet } from "svelte";

	import { DiffPill } from "../diff-pill/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import ShieldWarning from "phosphor-svelte/lib/ShieldWarning";

	import FeedItem from "./attention-queue-item.svelte";

	interface Props {
		selected?: boolean;
		onSelect?: () => void;
		title: string;
		timeAgo?: string | null;
		insertions: number;
		deletions: number;
		permissionLabel: string;
		command?: string | null;
		filePath?: string | null;
		projectBadge?: Snippet;
		agentBadge?: Snippet;
		actionBar: Snippet;
		icon?: Snippet;
	}

	let {
		selected = false,
		onSelect,
		title,
		timeAgo,
		insertions,
		deletions,
		permissionLabel,
		command = null,
		filePath = null,
		projectBadge,
		agentBadge,
		actionBar,
		icon,
	}: Props = $props();
</script>

<FeedItem {selected} {onSelect}>
	<div class="flex items-center gap-1.5">
		{#if projectBadge}
			{@render projectBadge()}
		{/if}
		{#if agentBadge}
			{@render agentBadge()}
		{/if}
		<div class="flex-1 min-w-0">
			<div class="text-xs font-medium truncate">{title}</div>
		</div>
		{#if timeAgo}
			<span class="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{timeAgo}</span>
		{/if}
		<div class="text-[10px] shrink-0 tabular-nums text-muted-foreground/70">
			<DiffPill {insertions} {deletions} variant="plain" />
		</div>
	</div>

	<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
		{#if icon}
			{@render icon()}
		{:else}
			<ShieldWarning weight="fill" class="size-3 shrink-0 text-primary" />
		{/if}
		<span class="shrink-0">{permissionLabel}</span>
		{#if filePath}
			<FilePathBadge {filePath} iconBasePath="/svgs/icons" interactive={false} />
		{:else if command}
			<code class="truncate font-mono text-foreground/70 min-w-0 flex-1"
				>$ {command}</code
			>
		{/if}
	</div>

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="flex items-center" onclick={(e) => e.stopPropagation()}>
		{@render actionBar()}
	</div>
</FeedItem>
