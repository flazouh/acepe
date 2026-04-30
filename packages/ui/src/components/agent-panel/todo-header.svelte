<script lang="ts">
	import type { Snippet } from "svelte";

	import type { AgentTodoItem } from "./types.js";

	import { untrack } from "svelte";

	import { SegmentedProgress } from "../segmented-progress/index.js";
	import { TextShimmer } from "../text-shimmer/index.js";
	import TodoNumberIcon from "./todo-number-icon.svelte";

	interface Props {
		items: readonly AgentTodoItem[];
		currentTask: AgentTodoItem | null;
		completedCount: number;
		totalCount: number;
		isLive: boolean;
		allCompletedLabel: string;
		pausedLabel: string;
		compact?: boolean;
		initiallyExpanded?: boolean;
		copyButton?: Snippet;
	}

	let {
		items,
		currentTask,
		completedCount,
		totalCount,
		isLive,
		allCompletedLabel,
		pausedLabel,
		compact = false,
		initiallyExpanded = true,
		copyButton,
	}: Props = $props();

	let isExpanded = $state(untrack(() => initiallyExpanded));

	const shouldRender = $derived(totalCount > 0);

	function formatDuration(durationMs: number | null | undefined): string {
		if (durationMs === null || durationMs === undefined) return "";
		const seconds = Math.floor(durationMs / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return `${hours}h ${remainingMinutes}m`;
	}

	function toggleExpanded(): void {
		isExpanded = !isExpanded;
	}
</script>

{#if shouldRender}
	<div class="w-full">
		{#if !compact && isExpanded}
			<div class="rounded-t-md bg-input/30 overflow-hidden border border-b-0 border-border">
				<div class="flex flex-col max-h-[300px] overflow-y-auto">
					{#each items as item, index (index)}
						{@const isInProgress = item.status === "in_progress"}
						{@const duration = formatDuration(item.duration)}
						<div
							class="flex items-center gap-2 px-3 py-1 text-sm leading-tight border-b border-border/30 last:border-b-0 {isInProgress
								? 'bg-muted'
								: ''}"
						>
							<span class="shrink-0">
								<TodoNumberIcon {index} status={item.status} {isLive} size={12} />
							</span>

							{#if isInProgress && isLive}
								<TextShimmer class="flex-1 truncate text-foreground text-sm">
									{item.content}
								</TextShimmer>
							{:else}
								<span
									class="flex-1 truncate {item.status === 'completed'
										? 'text-muted-foreground/60 line-through'
										: item.status === 'cancelled'
											? 'text-muted-foreground/40 line-through'
											: 'text-foreground'}"
								>
									{item.content}
								</span>
							{/if}

							{#if duration}
								<span class="shrink-0 text-muted-foreground font-mono text-sm">
									{duration}
								</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if compact}
			<div class="w-full flex items-center justify-between px-1.5 py-0.5">
				<div class="flex items-center gap-1.5 text-sm min-w-0">
					{#if isLive && currentTask}
						<TextShimmer class="truncate text-foreground text-sm">
							{currentTask.activeForm ? currentTask.activeForm : currentTask.content}
						</TextShimmer>
					{:else if currentTask}
						<span class="text-muted-foreground truncate">
							{currentTask.content}
						</span>
					{:else if completedCount === totalCount}
						<span class="text-muted-foreground">{allCompletedLabel}</span>
					{:else}
						<span class="text-muted-foreground">{pausedLabel}</span>
					{/if}
				</div>

				<div class="flex items-center gap-1.5 shrink-0">
					<SegmentedProgress current={completedCount} total={totalCount} />
					<span class="text-sm text-muted-foreground">
						{completedCount}/{totalCount}
					</span>
				</div>
			</div>
		{:else}
			<div
				role="button"
				tabindex={0}
				onclick={toggleExpanded}
				onkeydown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						toggleExpanded();
					}
				}}
				class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-input/30 cursor-pointer {isExpanded
					? 'rounded-t-none border-t-0'
					: ''}"
			>
				<div class="flex items-center gap-1.5 text-sm min-w-0">
					{#if isLive && currentTask}
						<span class="text-foreground font-medium truncate text-sm">
							{currentTask.activeForm ? currentTask.activeForm : currentTask.content}
						</span>
					{:else if currentTask}
						<span class="text-muted-foreground truncate">
							{currentTask.content}
						</span>
					{:else if completedCount === totalCount}
						<span class="text-muted-foreground">{allCompletedLabel}</span>
					{:else}
						<span class="text-muted-foreground">{pausedLabel}</span>
					{/if}
				</div>

				<div class="flex items-center gap-1.5 shrink-0">
					<SegmentedProgress current={completedCount} total={totalCount} />
					{#if copyButton}
						{@render copyButton()}
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
