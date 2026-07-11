<script lang="ts">
	import type { Snippet } from "svelte";

	import type { AgentTodoItem } from "./types.js";

	import { untrack } from "svelte";

	import { SegmentedProgress } from "../segmented-progress/index.js";
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
		{#if compact}
			<div class="w-full flex items-center justify-between px-1.5 py-0.5">
				<div class="flex items-center gap-1.5 text-sm min-w-0">
					{#if isLive && currentTask}
						<span class="truncate text-sm">
							{currentTask.activeForm ? currentTask.activeForm : currentTask.content}
						</span>
					{:else if currentTask}
						<span class="truncate">
							{currentTask.content}
						</span>
					{:else if completedCount === totalCount}
						<span>{allCompletedLabel}</span>
					{:else}
						<span>{pausedLabel}</span>
					{/if}
				</div>

				<div class="flex items-center gap-1.5 shrink-0">
					<SegmentedProgress current={completedCount} total={totalCount} />
					<span class="text-sm">
						{completedCount}/{totalCount}
					</span>
				</div>
			</div>
		{:else}
			<!--
				Single fully-rounded surface: the outer container owns the
				background and radius so the top corners always match the bottom
				(rounded-lg all around) whether or not the list is expanded. No
				border — a raised `bg-accent` fill (matching the sibling floating
				chips in this stack) lifts it off the panel/composer background,
				with a restrained `shadow-sm`. The list and the toggle row are
				transparent children clipped by overflow-hidden.
			-->
			<div
				data-testid="agent-todo-surface"
				class="rounded-lg bg-accent shadow-sm overflow-hidden"
			>
				{#if isExpanded}
					<div class="flex flex-col max-h-[300px] overflow-y-auto">
						{#each items as item, index (index)}
							{@const isInProgress = item.status === "in_progress"}
							{@const duration = formatDuration(item.duration)}
							<div
								class="flex items-center gap-2 border-b border-border/30 px-3 py-1 text-sm last:border-b-0 {isInProgress
									? 'bg-muted'
									: ''}"
							>
								<span class="shrink-0">
									<TodoNumberIcon status={item.status} {isLive} size={12} />
								</span>

								{#if isInProgress && isLive}
									<span class="flex-1 truncate text-sm">
										{item.content}
									</span>
								{:else}
									<span class="flex-1 truncate">
										{item.content}
									</span>
								{/if}

								{#if duration}
									<span class="shrink-0 text-sm">
										{duration}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

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
					class="w-full flex items-center justify-between px-3 py-1 cursor-pointer"
				>
					<div class="flex items-center gap-1.5 text-sm min-w-0">
						{#if isLive && currentTask}
							<span class="truncate text-sm">
								{currentTask.activeForm ? currentTask.activeForm : currentTask.content}
							</span>
						{:else if currentTask}
							<span class="truncate">
								{currentTask.content}
							</span>
						{:else if completedCount === totalCount}
							<span>{allCompletedLabel}</span>
						{:else}
							<span>{pausedLabel}</span>
						{/if}
					</div>

					<div class="flex items-center gap-1.5 shrink-0">
						<SegmentedProgress current={completedCount} total={totalCount} />
						{#if copyButton}
							{@render copyButton()}
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
