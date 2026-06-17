<script lang="ts">
	import { ListChecks } from "phosphor-svelte";
	import AgentToolCard from "./agent-tool-card.svelte";
	import {
		getTodoDisplayRows,
		getTodoProgressSummary,
	} from "./agent-tool-todo-state.js";
	import TodoNumberIcon from "./todo-number-icon.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import type { AgentTodoItem } from "./types.js";

	interface Props {
		/** List of todo items */
		todos?: AgentTodoItem[];
		/** Whether the session is live (affects in_progress display) */
		isLive?: boolean;
		/** Optional elapsed timing shown in the header */
		durationTiming?: ToolDurationTiming;
		/** Header label for the tasks section (e.g. "Tasks") */
		tasksLabel?: string;
		/** Fallback label when no todos are parsed (e.g. "Updated todos") */
		fallbackLabel?: string;
	}

	let { todos = [], isLive = false, durationTiming, tasksLabel = "Tasks", fallbackLabel = "Updated todos" }: Props = $props();

	const progress = $derived(getTodoProgressSummary(todos));
	const displayRows = $derived(
		getTodoDisplayRows({
			todos,
			isLive,
			inProgressIndex: progress.inProgressIndex,
		})
	);
</script>

{#if progress.totalTasks > 0}
	<AgentToolCard>
		<div class="px-3 py-2 space-y-2">
			<!-- Header with progress -->
			<div class="mb-1.5 flex items-center justify-between gap-2 text-sm">
				<div class="flex min-w-0 items-center gap-2">
					<span>{tasksLabel}</span>
					<AgentToolDurationLabel timing={durationTiming} class="text-sm" />
				</div>
				<span>{progress.completedCount}/{progress.totalTasks}</span>
			</div>

			<!-- Progress bar -->
			<div class="h-1 bg-muted rounded-full overflow-hidden">
				<div
					class="h-full bg-primary transition-all duration-300"
					style="width: {progress.progressPercent}%"
				></div>
			</div>

			<!-- Task list -->
			<div class="space-y-0.5">
				{#each displayRows as row (row.todo.content)}
					<div
						class="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-1 py-0.5 rounded text-sm {row.isCurrent
							? 'bg-muted/30'
							: ''}"
					>
						<!-- Numbered icon -->
						<span class="shrink-0">
							<TodoNumberIcon index={row.index} status={row.todo.status} {isLive} size={14} />
						</span>

						<!-- Content -->
						<span>
							{#if row.isCurrentAndLive}
								<span class="text-sm">{row.displayText}</span>
							{:else}
								{row.displayText}
							{/if}
						</span>

						<!-- Duration -->
						<span class="shrink-0 text-right text-sm">
							{row.durationText}
						</span>
					</div>
				{/each}
			</div>
		</div>
	</AgentToolCard>
{:else}
	<!-- Fallback when no todos parsed -->
	<AgentToolCard>
		<div class="flex items-center gap-2 px-3 py-2.5 text-sm">
			<ListChecks size={14} />
			<span>{fallbackLabel}</span>
		</div>
	</AgentToolCard>
{/if}
