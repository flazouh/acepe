<script lang="ts">
	import type { Snippet } from "svelte";
	import { X } from "phosphor-svelte";
	import AgentToolTask from "../agent-panel/agent-tool-task.svelte";
	import AgentToolRow from "../agent-panel/agent-tool-row.svelte";
	import { DiffPill } from "../diff-pill/index.js";
	import { capitalizeLeadingCharacter } from "../../lib/utils.js";
	import {
		EmbeddedIconButton,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { SegmentedProgress } from "../segmented-progress/index.js";
	import { TextShimmer } from "../text-shimmer/index.js";
	import type { KanbanCardData } from "./types.js";

	interface Props {
		card: KanbanCardData;
		children?: Snippet;
		onclick?: () => void;
		/** Close button callback. When provided, renders a compact X button in the header. */
		onClose?: () => void;
		footer?: Snippet;
		tally?: Snippet;
		/** Renders a todo header section at the bottom of the card body. When provided, inline todoProgress in the tally is hidden. */
		todoSection?: Snippet;
		showFooter?: boolean;
		showTally?: boolean;
		/** When true the footer renders without padding so embedded composers sit flush. */
		flushFooter?: boolean;
		/** When true, hide the body content (tool calls, activity text). Used when a permission request is shown instead. */
		hideBody?: boolean;
		menu?: Snippet;
	}

	let {
		card,
		onclick,
		onClose,
		footer,
		tally,
		todoSection,
		showFooter = false,
		showTally = false,
		flushFooter = false,
		hideBody = false,
		menu,
	}: Props = $props();

	const title = $derived(card.title ? capitalizeLeadingCharacter(card.title) : "Untitled session");
	const hasDiff = $derived(card.diffInsertions > 0 || card.diffDeletions > 0);
	const isInteractive = $derived(Boolean(onclick));
	const showBody = $derived(!hideBody && Boolean(card.taskCard || card.latestTool || card.activityText || card.errorText));
	const hasTodoSection = $derived(todoSection !== undefined);
	const hasFooterContent = $derived(card.todoProgress !== null && !hasTodoSection ? true : showTally);
	const hasMenu = $derived(menu !== undefined);
	const hasClose = $derived(Boolean(onClose));
	const headerDiffDivider = $derived(hasMenu ? true : hasClose);

	function handleKeydown(event: KeyboardEvent): void {
		if (!onclick) return;
		if (event.key !== "Enter" && event.key !== " ") return;
		if (event.target !== event.currentTarget) return;
		event.preventDefault();
		onclick();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="flex flex-col overflow-hidden rounded-sm border border-border/60 bg-accent/30 transition-all duration-150 {isInteractive
		? 'cursor-pointer hover:border-border hover:bg-accent/45 hover:shadow-[0_8px_24px_-16px_rgba(0,0,0,0.9)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/80 focus-visible:ring-offset-0'
		: ''}"
	onclick={onclick}
	onkeydown={handleKeydown}
	role={onclick ? "button" : undefined}
	tabindex={onclick ? 0 : undefined}
	data-testid="kanban-card"
>
	<!-- Header: project badge, agent icon, status dot, diff, actions -->
	<div data-testid="kanban-card-header">
		<EmbeddedPanelHeader class="bg-card/50">
			<HeaderCell withDivider={false}>
				<ProjectLetterBadge name={card.projectName} color={card.projectColor} size={14} sequenceId={card.sequenceId} class="shrink-0" />
			</HeaderCell>
			<HeaderCell>
				<img src={card.agentIconSrc} alt={card.agentLabel} width="14" height="14" class="shrink-0 rounded-sm" />
			</HeaderCell>
			{#if card.hasUnseenCompletion}
				<HeaderTitleCell compactPadding>
					<div class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
						<span
							class="size-1.5 shrink-0 rounded-full"
							style="background-color: var(--success-reference)"
							title="Finished — not yet reviewed"
							data-testid="unseen-completion-dot"
						></span>
					</div>
				</HeaderTitleCell>
			{/if}
			{#if hasDiff}
				<HeaderActionCell withDivider={headerDiffDivider} class="px-1">
					<div class="flex h-7 items-center justify-center">
						<DiffPill insertions={card.diffInsertions} deletions={card.diffDeletions} variant="plain" class="text-[10px]" />
					</div>
				</HeaderActionCell>
			{/if}
			{#if menu}
				<HeaderActionCell withDivider={true}>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="flex h-7 items-center justify-center" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
						{@render menu()}
					</div>
				</HeaderActionCell>
			{/if}
			{#if onClose}
				<HeaderActionCell withDivider={false}>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="flex h-7 items-center justify-center" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
						<EmbeddedIconButton onclick={onClose} title="Close" ariaLabel="Close" class="!h-full border-l border-border/40">
							{#snippet children()}
								<X size={12} weight="bold" />
							{/snippet}
						</EmbeddedIconButton>
					</div>
				</HeaderActionCell>
			{/if}
		</EmbeddedPanelHeader>
	</div>

	<div class="border-b border-border/40 px-1.5 py-1" data-testid="kanban-card-title">
		<div class="min-w-0">
			<span class="block text-xs font-medium leading-tight text-foreground">{title}</span>
		</div>
	</div>

	<!-- Content: task card, activity text, or latest tool -->
	{#if showBody}
		<div class="flex flex-col gap-1 px-1 pt-1 pb-1">
			{#if card.taskCard}
				<AgentToolTask
					description={card.taskCard.summary}
					status={card.taskCard.isStreaming ? "running" : "done"}
					children={card.taskCard.toolCalls}
					compact={true}
					iconBasePath="/svgs/icons"
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

	{#if flushFooter}
		<!-- Tally footer: usage + todo segments + diff pill -->
		{#if hasFooterContent}
			<div class="flex min-w-0 flex-wrap items-center gap-2 border-t border-border/40 px-1.5 py-0.5" data-testid="kanban-card-tally">
				{#if tally}
					{#if showTally}
						<div class="flex min-w-0 shrink-0 items-center">
							{@render tally()}
						</div>
					{/if}
				{/if}
				{#if card.todoProgress && !hasTodoSection}
					<span class="shrink-0 text-[10px] text-muted-foreground">{card.todoProgress.label}</span>
					<SegmentedProgress current={card.todoProgress.current} total={card.todoProgress.total} />
					<span class="text-[10px] text-muted-foreground">
						{card.todoProgress.current}/{card.todoProgress.total}
					</span>
				{/if}
			</div>
		{/if}

		<!-- Todo section (compact todo header) -->
		{#if hasTodoSection && todoSection}
			<div class="border-t border-border/40">
				{@render todoSection()}
			</div>
		{/if}

		<!-- Footer slot (question / permission / composer) -->
		{#if showFooter && footer}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="border-t border-border/40 {flushFooter ? '' : 'px-1.5 py-1'}" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				{@render footer()}
			</div>
		{/if}
	{:else}
		<!-- Footer slot (question / permission / composer) -->
		{#if showFooter && footer}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="border-t border-border/40 {flushFooter ? '' : 'px-1.5 py-1'}" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				{@render footer()}
			</div>
		{/if}

		<!-- Tally footer: usage + todo segments + diff pill -->
		{#if hasFooterContent}
			<div class="flex min-w-0 flex-wrap items-center gap-2 border-t border-border/40 px-1.5 py-0.5" data-testid="kanban-card-tally">
				{#if tally}
					{#if showTally}
						<div class="flex min-w-0 shrink-0 items-center">
							{@render tally()}
						</div>
					{/if}
				{/if}
				{#if card.todoProgress && !hasTodoSection}
					<span class="shrink-0 text-[10px] text-muted-foreground">{card.todoProgress.label}</span>
					<SegmentedProgress current={card.todoProgress.current} total={card.todoProgress.total} />
					<span class="text-[10px] text-muted-foreground">
						{card.todoProgress.current}/{card.todoProgress.total}
					</span>
				{/if}
			</div>
		{/if}

		<!-- Todo section (compact todo header) -->
		{#if hasTodoSection && todoSection}
			<div class="border-t border-border/40">
				{@render todoSection()}
			</div>
		{/if}
	{/if}
</div>
