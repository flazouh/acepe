<script lang="ts">
	import type { Snippet } from "svelte";
	import AgentToolRow from "../agent-panel/agent-tool-row.svelte";
	import ToolTally from "../agent-panel/tool-tally.svelte";
	import { DiffPill } from "../diff-pill/index.js";
	import { BuildIcon, PlanIcon } from "../icons/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { SegmentedProgress } from "../segmented-progress/index.js";
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
	const isPlan = $derived(card.modeId === "plan");
	const accentColor = $derived(isPlan ? "var(--plan-icon)" : "var(--build-icon)");
	const hasFooterContent = $derived(
		hasDiff || card.todoProgress !== null || card.toolCalls.length > 0
	);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex flex-col overflow-hidden rounded-sm border border-border/60 bg-accent/30"
	onclick={onclick}
	data-testid="kanban-card"
>
	<!-- Header: project badge, agent icon, title, mode icon -->
	<div class="flex items-center gap-1.5 px-2 py-1.5" data-testid="kanban-card-header">
		<div
			class="w-0.5 shrink-0 self-stretch rounded-full"
			style="background-color: {accentColor}"
			data-testid="kanban-card-accent"
		></div>
		<ProjectLetterBadge name={card.projectName} color={card.projectColor} size={14} class="shrink-0" />
		<img src={card.agentIconSrc} alt={card.agentLabel} width="14" height="14" class="shrink-0 rounded-sm" />
		<span class="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{title}</span>
		<span class="shrink-0 text-[10px] text-muted-foreground">{card.timeAgo}</span>
		{#if isPlan}
			<PlanIcon size="sm" />
		{:else}
			<BuildIcon size="sm" />
		{/if}
	</div>

	<!-- Content: activity text + latest tool -->
	{#if card.activityText || card.latestTool || card.errorText}
		<div class="flex flex-col gap-1 border-t border-border/40 px-2 py-1.5">
			{#if card.activityText}
				<div class="font-mono text-[10px] text-muted-foreground">
					{#if card.isStreaming}
						<TextShimmer class="block truncate">{card.activityText}</TextShimmer>
					{:else}
						<span class="block truncate">{card.activityText}</span>
					{/if}
				</div>
			{/if}

			{#if card.latestTool}
				<AgentToolRow
					title={card.latestTool.title}
					filePath={card.latestTool.filePath}
					status={card.latestTool.status}
					kind={card.latestTool.kind}
					iconBasePath="/svgs/icons"
				/>
			{/if}

			{#if card.errorText}
				<span class="truncate text-[10px] text-red-500">{card.errorText}</span>
			{/if}
		</div>
	{/if}

	<!-- Footer slot (question / permission) -->
	{#if footer}
		<div class="border-t border-border/40 px-2 py-1.5">
			{@render footer()}
		</div>
	{/if}

	<!-- Tally footer: todo segments + tool tally + diff pill -->
	{#if hasFooterContent}
		<div class="flex items-center gap-2 border-t border-border/40 px-2 py-1" data-testid="kanban-card-tally">
			{#if card.todoProgress}
				<SegmentedProgress current={card.todoProgress.current} total={card.todoProgress.total} />
				<span class="text-[10px] text-muted-foreground">
					{card.todoProgress.current}/{card.todoProgress.total}
				</span>
			{/if}
			{#if card.toolCalls.length > 0}
				<ToolTally toolCalls={[...card.toolCalls]} inline={true} />
			{/if}
			{#if hasDiff}
				<DiffPill insertions={card.diffInsertions} deletions={card.diffDeletions} variant="plain" class="text-[10px]" />
			{/if}
		</div>
	{/if}
</div>