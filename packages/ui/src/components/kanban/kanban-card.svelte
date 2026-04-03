<script lang="ts">
	import type { Snippet } from "svelte";
	import AgentToolRow from "../agent-panel/agent-tool-row.svelte";
	import ToolTally from "../agent-panel/tool-tally.svelte";
	import QueueSubagentCard from "../attention-queue/attention-queue-subagent-card.svelte";
	import { DiffPill } from "../diff-pill/index.js";
	import { MarkdownDisplay } from "../markdown/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { SegmentedProgress } from "../segmented-progress/index.js";
	import { TextShimmer } from "../text-shimmer/index.js";
	import type { KanbanCardData } from "./types.js";

	interface Props {
		card: KanbanCardData;
		onclick?: () => void;
		footer?: Snippet;
		showFooter?: boolean;
		/** When true the footer renders without padding so embedded composers sit flush. */
		flushFooter?: boolean;
		menu?: Snippet;
	}

	let { card, onclick, footer, showFooter = false, flushFooter = false, menu }: Props = $props();

	const title = $derived(card.title ? card.title : "Untitled session");
	const hasDiff = $derived(card.diffInsertions > 0 || card.diffDeletions > 0);
	const isInteractive = $derived(Boolean(onclick));
	const showBody = $derived(
		Boolean(
			card.previewMarkdown ||
			card.taskCard ||
			card.latestTool ||
			(card.activityText && !card.latestTool) ||
			card.errorText
		)
	);
	const hasFooterContent = $derived(
		hasDiff || card.todoProgress !== null || card.toolCalls.length > 0
	);

	function handleKeydown(event: KeyboardEvent): void {
		if (!onclick) return;
		if (event.key !== "Enter" && event.key !== " ") return;
		if (event.target !== event.currentTarget) return;
		event.preventDefault();
		onclick();
	}
</script>

<div
	class="flex flex-col overflow-hidden rounded-sm border border-border/60 bg-accent/30 transition-all duration-150 {isInteractive
		? 'cursor-pointer hover:translate-x-px hover:border-border hover:bg-accent/45 hover:shadow-[0_8px_24px_-16px_rgba(0,0,0,0.9)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/80 focus-visible:ring-offset-0'
		: ''}"
	onclick={onclick}
	onkeydown={handleKeydown}
	role={onclick ? "button" : undefined}
	tabindex={onclick ? 0 : undefined}
	data-testid="kanban-card"
>
	<!-- Header: project badge, agent icon, title, time, menu -->
	<div class="flex items-center gap-1.5 px-2 py-1.5" data-testid="kanban-card-header">
		<ProjectLetterBadge name={card.projectName} color={card.projectColor} size={14} class="shrink-0" />
		<img src={card.agentIconSrc} alt={card.agentLabel} width="14" height="14" class="shrink-0 rounded-sm" />
		<span class="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{title}</span>
		<span class="shrink-0 text-[10px] text-muted-foreground">{card.timeAgo}</span>
		{#if menu}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				{@render menu()}
			</div>
		{/if}
	</div>

	<!-- Content: task card, activity text, or latest tool -->
	{#if showBody}
		<div class="flex flex-col gap-1 border-t border-border/40 px-1 py-1.5">
			{#if card.previewMarkdown}
				<MarkdownDisplay content={card.previewMarkdown} scrollable={true} class="kanban-markdown-preview text-[10px]" />
			{/if}

			{#if card.taskCard}
				<QueueSubagentCard
					summary={card.taskCard.summary}
					isStreaming={card.taskCard.isStreaming}
					latestTool={card.taskCard.latestTool}
					toolCalls={[...card.taskCard.toolCalls]}
				/>
			{:else if card.latestTool}
				<AgentToolRow
					title={card.latestTool.title}
					filePath={card.latestTool.filePath}
					status={card.latestTool.status}
					kind={card.latestTool.kind}
					iconBasePath="/svgs/icons"
				/>
			{:else if card.activityText}
				<div class="font-mono text-[10px] text-muted-foreground">
					{#if card.isStreaming}
						<TextShimmer class="block truncate">{card.activityText}</TextShimmer>
					{:else}
						<span class="block truncate">{card.activityText}</span>
					{/if}
				</div>
			{/if}

			{#if card.errorText}
				<span class="truncate text-[10px] text-red-500">{card.errorText}</span>
			{/if}
		</div>
	{/if}

	<!-- Footer slot (question / permission) -->
	{#if showFooter && footer}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="border-t border-border/40 {flushFooter ? '' : 'px-1.5 py-1'}" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			{@render footer()}
		</div>
	{/if}

	<!-- Tally footer: todo segments + tool tally + diff pill -->
	{#if hasFooterContent}
		<div class="flex items-center gap-2 border-t border-border/40 px-1.5 py-0.5" data-testid="kanban-card-tally">
			{#if card.todoProgress}
				<span class="shrink-0 text-[10px] text-muted-foreground">{card.todoProgress.label}</span>
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

<style>
	:global(.kanban-markdown-preview) {
		max-height: 4.5rem;
	}

	:global(.kanban-markdown-preview .markdown-content),
	:global(.kanban-markdown-preview .markdown-loading) {
		padding: 0 0.5rem;
		font-size: 0.625rem;
		line-height: 1.35;
	}

	:global(.kanban-markdown-preview .markdown-content > :first-child) {
		margin-top: 0;
	}

	:global(.kanban-markdown-preview .markdown-content > :last-child) {
		margin-bottom: 0;
	}

	:global(.kanban-markdown-preview .markdown-content h1),
	:global(.kanban-markdown-preview .markdown-content h2),
	:global(.kanban-markdown-preview .markdown-content h3),
	:global(.kanban-markdown-preview .markdown-content h4),
	:global(.kanban-markdown-preview .markdown-content p),
	:global(.kanban-markdown-preview .markdown-content ul),
	:global(.kanban-markdown-preview .markdown-content ol),
	:global(.kanban-markdown-preview .markdown-content blockquote),
	:global(.kanban-markdown-preview .markdown-content pre) {
		margin-top: 0.2rem;
		margin-bottom: 0.2rem;
	}

	:global(.kanban-markdown-preview .markdown-content h1),
	:global(.kanban-markdown-preview .markdown-content h2),
	:global(.kanban-markdown-preview .markdown-content h3),
	:global(.kanban-markdown-preview .markdown-content h4) {
		font-size: 0.7rem;
		line-height: 1.3;
	}

	:global(.kanban-markdown-preview .markdown-content code),
	:global(.kanban-markdown-preview .markdown-loading code) {
		font-size: 0.6rem;
	}
</style>