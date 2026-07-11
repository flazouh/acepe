<script lang="ts">
	import AgentToolCard from "./agent-tool-card.svelte";
	import {
		getTodoDisplayRows,
		getTodoProgressSummary,
	} from "./agent-tool-todo-state.js";
	import TodoNumberIcon from "./todo-number-icon.svelte";
	import ToolKindIcon from "./tool-kind-icon.svelte";
	import type { AgentTodoItem } from "./types.js";

	interface Props {
		/** List of todo items */
		todos?: AgentTodoItem[];
		/** Whether the session is live (affects in_progress display) */
		isLive?: boolean;
		/** Fallback label when no todos are parsed (e.g. "Updated todos") */
		fallbackLabel?: string;
	}

	let { todos = [], isLive = false, fallbackLabel = "Updated todos" }: Props = $props();

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
		<div class="flex flex-col gap-px p-1.5">
			{#each displayRows as row (row.todo.content)}
				<div
					class="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded px-1.5 py-1 text-sm {row.isCurrent
						? 'bg-muted/40'
						: ''}"
				>
					<!-- Status icon -->
					<TodoNumberIcon status={row.todo.status} {isLive} size={14} class="shrink-0" />

					<!-- Content -->
					<span
						class="min-w-0 {row.todo.status === 'completed'
							? 'text-muted-foreground'
							: ''}"
					>
						{row.displayText}
					</span>

					<!-- Duration -->
					<span class="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
						{row.durationText}
					</span>
				</div>
			{/each}
		</div>
	</AgentToolCard>
{:else}
	<!-- Fallback when no todos parsed -->
	<AgentToolCard>
		<div class="flex items-center gap-2 px-3 py-2.5 text-sm">
			<ToolKindIcon kind="task" size={14} />
			<span>{fallbackLabel}</span>
		</div>
	</AgentToolCard>
{/if}
