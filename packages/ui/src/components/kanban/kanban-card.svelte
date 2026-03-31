<script lang="ts">
	import type { Snippet } from "svelte";
	import { Colors } from "../../lib/colors.js";
	import { TextShimmer } from "../text-shimmer/index.js";
	import type { KanbanCardData } from "./types.js";

	interface Props {
		card: KanbanCardData;
		onclick?: () => void;
		footer?: Snippet;
	}

	let { card, onclick, footer }: Props = $props();

	const title = $derived(card.title ? card.title : "Untitled session");
	const hasDiff = $derived(card.diffInsertions > 0 || card.diffDeletions > 0);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex flex-col gap-1.5 rounded-sm border border-border/60 bg-accent/30 px-2.5 py-2"
	onclick={onclick}
	data-testid="kanban-card"
>
	<div class="flex items-start gap-1.5">
		<div
			class="w-0.5 shrink-0 self-stretch rounded-full"
			style="background-color: {Colors.purple}"
			data-testid="kanban-card-accent"
		></div>
		<img src={card.agentIconSrc} alt={card.agentLabel} width="14" height="14" class="mt-0.5 shrink-0 rounded-sm" />
		<div class="min-w-0 flex-1">
			<div class="flex items-baseline justify-between gap-1">
				<span class="truncate text-xs font-medium text-foreground">{title}</span>
				<span class="shrink-0 text-[10px] text-muted-foreground">{card.timeAgo}</span>
			</div>
		</div>
	</div>

	<div class="flex flex-wrap items-center gap-1 pl-4">
		<span class="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{card.agentLabel}</span>
		<span
			class="rounded-sm px-1 py-0.5 text-[10px]"
			style="background-color: {card.projectColor}20; color: {card.projectColor}"
		>{card.projectName}</span>
		{#if card.modeLabel}
			<span class="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{card.modeLabel}</span>
		{/if}
	</div>

	{#if card.activityText}
		<div class="pl-4 font-mono text-[10px] text-muted-foreground">
			{#if card.isStreaming}
				<TextShimmer class="block truncate">{card.activityText}</TextShimmer>
			{:else}
				<span class="block truncate">{card.activityText}</span>
			{/if}
		</div>
	{/if}

	{#if hasDiff || card.todoProgress || card.errorText}
		<div class="flex flex-wrap items-center gap-1.5 pl-4 text-[10px]">
			{#if hasDiff}
				<span class="text-green-500">+{card.diffInsertions}</span>
				<span class="text-red-500">-{card.diffDeletions}</span>
			{/if}
			{#if card.todoProgress}
				<span class="text-muted-foreground">
					{card.todoProgress.current}/{card.todoProgress.total} todos
				</span>
			{/if}
			{#if card.errorText}
				<span class="truncate text-red-500">{card.errorText}</span>
			{/if}
		</div>
	{/if}

	{#if footer}
		{@render footer()}
	{/if}
</div>