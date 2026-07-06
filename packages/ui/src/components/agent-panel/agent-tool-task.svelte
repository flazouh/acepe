<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Dialog from "../dialog/index.js";
	import AgentPanelSceneEntry from "../agent-panel-scene/agent-panel-scene-entry.svelte";
	import { SegmentedProgressBar } from "../segmented-progress-bar/index.js";
	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import type { AgentToolStatus, AnyAgentEntry } from "./types.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import AgentCompactToolDisplay from "./compact-tool-display.svelte";
	import CylinderSwap from "./cylinder-swap.svelte";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import type { EditToolTheme } from "./agent-tool-edit-theme.js";
	import {
		getLastTaskToolCall,
		getTaskCurrentToolDisplay,
		getTaskProgress,
		getTaskTitle,
		getTaskToolChildren,
		getTaskUiClasses,
		hasTaskPrompt,
		hasTaskResult,
		isTaskPending,
		shouldShowTaskProgress,
	} from "./agent-tool-task-state.js";

	interface Props {
		description: string | null;
		prompt?: string | null;
		resultText?: string | null;
		children?: readonly AnyAgentEntry[];
		status?: AgentToolStatus;
		showDoneIcon?: boolean;
		compact?: boolean;
		durationTiming?: ToolDurationTiming;
		iconBasePath?: string;
		editToolTheme?: EditToolTheme;
		runningFallback?: string;
		doneFallback?: string;
		resultLabel?: string;
		detailOpen?: boolean;
		onDetailOpenChange?: (open: boolean) => void;
		renderDetailEntry?: Snippet<[AnyAgentEntry]>;
	}

	let {
		description,
		prompt,
		resultText,
		children = [],
		status = "done",
		showDoneIcon = false,
		compact = false,
		durationTiming,
		iconBasePath = "",
		editToolTheme,
		runningFallback = "Running task…",
		doneFallback = "Task",
		resultLabel = "Result",
		detailOpen = $bindable(false),
		onDetailOpenChange,
		renderDetailEntry,
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

	const taskChildren = $derived(Array.from(children));
	const toolCallChildren = $derived(getTaskToolChildren(taskChildren));
	const lastToolCall = $derived(getLastTaskToolCall(toolCallChildren));
	const currentToolDisplay = $derived(getTaskCurrentToolDisplay(lastToolCall));
	const taskProgress = $derived(getTaskProgress({ toolCallChildren }));
	const showProgress = $derived(shouldShowTaskProgress(taskProgress.totalCount));

	const hasPrompt = $derived(hasTaskPrompt(prompt));
	const hasResult = $derived(hasTaskResult({ status, resultText }));
	const hasChildren = $derived(taskChildren.length > 0);
	const shouldShowDoneIcon = $derived(showDoneIcon && isDone);
	const taskClasses = $derived(getTaskUiClasses(compact));
	const cardClass = $derived(taskClasses.card);
	const headerClass = $derived(taskClasses.header);
	const headerContentClass = $derived(taskClasses.headerContent);
	const liveRowClass = $derived(taskClasses.liveRow);
	const progressAriaLabel = $derived(
		`${taskProgress.filledCount} of ${taskProgress.totalCount} tool calls complete`
	);
	const showDetailTrigger = $derived(hasChildren || hasPrompt || hasResult);
	const showLiveRow = $derived(isTaskPending(status) && currentToolDisplay !== null);
	const liveRowHeight = $derived(compact ? "1.25rem" : "1.375rem");

	function handleDetailOpenChange(nextOpen: boolean): void {
		detailOpen = nextOpen;
		onDetailOpenChange?.(nextOpen);
	}
</script>

<AgentToolCard class={cardClass} dataTestid="agent-tool-task-card">
	<div class={headerClass}>
		<div class={headerContentClass}>
			<ToolHeaderLeading kind="task" {status} class="min-w-0 flex-1 truncate">
				{titleText}
			</ToolHeaderLeading>
		</div>

		{#if showProgress}
			<div class="w-[52px] shrink-0" data-testid="agent-tool-task-progress">
				<SegmentedProgressBar
					ariaLabel={progressAriaLabel}
					label=""
					percent={0}
					filledSegmentCount={taskProgress.filledCount}
					segmentCount={taskProgress.totalCount}
					showPercent={false}
					decorative={true}
					variant="downloadCompact"
				/>
			</div>
		{/if}

		<AgentToolDurationLabel timing={durationTiming} class="shrink-0 font-sans text-xs" />

		{#if showDetailTrigger}
			<Button
				variant="ghost"
				size="icon-2xs"
				data-header-control
				aria-label="Open subtask transcript"
				title="Open subtask transcript"
				data-testid="agent-tool-task-open-button"
				onclick={() => {
					handleDetailOpenChange(true);
				}}
			>
				{#snippet children()}
					<RoundedIcon name="expand" />
				{/snippet}
			</Button>
		{/if}

		{#if shouldShowDoneIcon}
			<RoundedIcon
				name="check-circle-filled"
				class="size-3 shrink-0 text-success"
				data-testid="agent-tool-task-success-icon"
			/>
		{/if}
	</div>

	{#if showLiveRow && currentToolDisplay}
		<div class={liveRowClass} data-testid="agent-tool-task-live-tool">
			<CylinderSwap key={currentToolDisplay.id} height={liveRowHeight} class="w-full">
				{#snippet children()}
					<div data-testid="agent-tool-task-current-tool-label" class="min-w-0">
						<AgentCompactToolDisplay tool={currentToolDisplay} {iconBasePath} />
					</div>
				{/snippet}
			</CylinderSwap>
		</div>
	{/if}
</AgentToolCard>

<Dialog.Root open={detailOpen} onOpenChange={handleDetailOpenChange}>
	<Dialog.Content class="flex h-[min(86vh,860px)] max-h-[min(86vh,860px)] w-full max-w-2xl flex-col overflow-hidden p-0 sm:max-w-2xl">
		<Dialog.Title class="sr-only">{titleText}</Dialog.Title>
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div class="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-2">
				<ToolHeaderLeading kind="task" {status}>
					{titleText}
				</ToolHeaderLeading>
				{#if showProgress}
					<SegmentedProgressBar
						ariaLabel={progressAriaLabel}
						label=""
						percent={0}
						filledSegmentCount={taskProgress.filledCount}
						segmentCount={taskProgress.totalCount}
						showPercent={false}
						decorative={true}
						variant="downloadCompact"
					/>
				{/if}
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto" data-testid="agent-tool-task-detail-body">
				{#if hasPrompt && prompt}
					<div class="px-3 py-1.5">
						<div class="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm whitespace-pre-wrap break-words">
							{prompt}
						</div>
					</div>
				{/if}

				{#if hasChildren}
					{#if renderDetailEntry}
						<div class="py-2">
							{#each taskChildren as child (child.id)}
								<div class="px-3 py-1.5">
									{@render renderDetailEntry(child)}
								</div>
							{/each}
						</div>
					{:else}
						<div class="py-2">
							{#each taskChildren as child (child.id)}
								<div class="px-3 py-1.5">
									<AgentPanelSceneEntry entry={child} {iconBasePath} {editToolTheme} />
								</div>
							{/each}
						</div>
					{/if}
				{/if}

				{#if hasResult && resultText}
					<div class="px-3 py-1.5">
						<div class="rounded-md border border-border/40 bg-muted/30 px-3 py-2">
							<div class="mb-1 text-xs font-medium text-muted-foreground">{resultLabel}</div>
							<div class="text-sm whitespace-pre-wrap break-words">{resultText}</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
