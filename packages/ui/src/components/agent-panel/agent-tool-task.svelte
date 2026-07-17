<script lang="ts">
	import * as Dialog from "../dialog/index.js";
	import { Button } from "../button/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import type {
		AgentTaskDetailBinding,
		AgentTaskLatestAction,
		AgentToolStatus,
	} from "./types.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import AgentCompactToolDisplay from "./compact-tool-display.svelte";
	import CylinderSwap from "./cylinder-swap.svelte";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import {
		getTaskTitle,
		getTaskUiClasses,
		hasTaskPrompt,
		isTaskPending,
	} from "./agent-tool-task-state.js";

	interface Props {
		description: string | null;
		prompt?: string | null;
		latestAction?: AgentTaskLatestAction | null;
		detail?: AgentTaskDetailBinding | null;
		status?: AgentToolStatus;
		showDoneIcon?: boolean;
		compact?: boolean;
		durationTiming?: ToolDurationTiming;
		iconBasePath?: string;
		runningFallback?: string;
		doneFallback?: string;
	}

	let {
		description,
		prompt,
		latestAction = null,
		detail = null,
		status = "done",
		showDoneIcon = false,
		compact = false,
		durationTiming,
		iconBasePath = "/svgs/icons",
		runningFallback = "Running task…",
		doneFallback = "Task",
	}: Props = $props();

	const isDone = $derived(status === "done");
	const titleText = $derived(
		getTaskTitle({
			description,
			status,
			runningFallback,
			doneFallback,
		})
	);

	const hasPrompt = $derived(hasTaskPrompt(prompt));
	const shouldShowDoneIcon = $derived(showDoneIcon && isDone);
	const taskClasses = $derived(getTaskUiClasses(compact));
	const cardClass = $derived(taskClasses.card);
	const headerClass = $derived(taskClasses.header);
	const headerContentClass = $derived(taskClasses.headerContent);
	const liveRowClass = $derived(taskClasses.liveRow);
	const showDetailTrigger = $derived(detail !== null);
	const showLiveRow = $derived(isTaskPending(status) && latestAction !== null);
	const liveRowHeight = $derived(compact ? "1.25rem" : "1.375rem");

	function handleDetailOpenChange(nextOpen: boolean): void {
		detail?.onOpenChange(nextOpen);
	}
</script>

<AgentToolCard class={cardClass} dataTestid="agent-tool-task-card">
	<div class={headerClass}>
		<div class={headerContentClass}>
			<ToolHeaderLeading kind="task" {status} class="min-w-0 flex-1 truncate">
				{titleText}
			</ToolHeaderLeading>
		</div>

		<AgentToolDurationLabel timing={durationTiming} class="shrink-0 font-sans text-xs" />

		{#if showDetailTrigger}
			<Button
				variant="ghost"
				size="icon-sm"
				data-header-control
				class="text-muted-foreground"
				aria-label="Open subtask transcript"
				title="Open subtask transcript"
				data-testid="agent-tool-task-open-button"
				onclick={() => {
					handleDetailOpenChange(true);
				}}
			>
				{#snippet children()}
					<HugeiconsIcon name="expand" />
				{/snippet}
			</Button>
		{/if}

		{#if shouldShowDoneIcon}
			<HugeiconsIcon
				name="check-circle-filled"
				class="size-3 shrink-0 text-success"
				data-testid="agent-tool-task-success-icon"
			/>
		{/if}
	</div>

	{#if showLiveRow && latestAction}
		<div class={liveRowClass} data-testid="agent-tool-task-live-tool">
			<CylinderSwap key={latestAction.id} height={liveRowHeight} class="w-full">
				{#snippet children()}
					<div data-testid="agent-tool-task-current-tool-label" class="min-w-0">
						<AgentCompactToolDisplay tool={latestAction} {iconBasePath} />
					</div>
				{/snippet}
			</CylinderSwap>
		</div>
	{/if}
</AgentToolCard>

<Dialog.Root open={detail?.presentation.open ?? false} onOpenChange={handleDetailOpenChange}>
	<Dialog.Content class="flex h-[min(86vh,860px)] max-h-[min(86vh,860px)] w-full max-w-2xl flex-col overflow-hidden p-0 sm:max-w-2xl">
		<Dialog.Title class="sr-only">{titleText}</Dialog.Title>
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div class="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-2">
				<ToolHeaderLeading kind="task" {status}>
					{titleText}
				</ToolHeaderLeading>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto" data-testid="agent-tool-task-detail-body">
				{#if hasPrompt && prompt}
					<div class="px-3 py-1.5">
						<div class="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm whitespace-pre-wrap break-words">
							{prompt}
						</div>
					</div>
				{/if}

				{#if detail}
					{#if detail.presentation.status === "loading" && detail.presentation.rows.length === 0}
						<div class="px-3 py-4 text-sm text-muted-foreground">Loading transcript…</div>
					{/if}

					{#if detail.presentation.rows.length > 0}
						<div class="py-2" data-testid="agent-tool-task-transcript-rows">
							{#each detail.presentation.rows as row, rowIndex (row.rowId)}
								<div class="px-3 py-1.5" data-task-transcript-row-id={row.rowId}>
									{@render detail.renderRow(row, rowIndex)}
								</div>
							{/each}
						</div>
					{:else if detail.presentation.status === "ready"}
						<div class="px-3 py-4 text-sm text-muted-foreground">No transcript rows yet.</div>
					{/if}

					{#if detail.presentation.errorMessage}
						<div class="px-3 py-2 text-sm text-destructive">{detail.presentation.errorMessage}</div>
					{/if}

					{#if detail.presentation.hasMore}
						<div class="flex justify-center px-3 py-2">
							<Button
								variant="outline"
								size="sm"
								onclick={detail.onLoadMore}
								data-testid="agent-tool-task-load-more"
							>
								{#snippet children()}Load more{/snippet}
							</Button>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
