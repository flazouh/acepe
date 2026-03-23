<script lang="ts">
	import ListChecks from "phosphor-svelte/lib/ListChecks";
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
	import { TextShimmer } from "../text-shimmer/index.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import TodoNumberIcon from "./todo-number-icon.svelte";
	import type { AgentTodoItem } from "./types.js";

	interface Props {
		/** List of todo items */
		todos?: AgentTodoItem[];
		/** Whether the session is live (affects in_progress display) */
		isLive?: boolean;
		/** Optional elapsed label shown in the header (e.g. "for 2.34s") */
		durationLabel?: string;
		/** Header label for the tasks section (e.g. "Tasks") */
		tasksLabel?: string;
		/** Fallback label when no todos are parsed (e.g. "Updated todos") */
		fallbackLabel?: string;
	}

	let { todos = [], isLive = false, durationLabel, tasksLabel = "Tasks", fallbackLabel = "Updated todos" }: Props = $props();

	const totalTasks = $derived(todos.length);
	const completedCount = $derived(todos.filter((t) => t.status === "completed").length);
	const inProgressIndex = $derived(todos.findIndex((t) => t.status === "in_progress"));
	const progressPercent = $derived(
		totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0
	);

	function formatDuration(durationMs: number | null | undefined): string {
		if (durationMs === null || durationMs === undefined) return "-";
		const seconds = Math.floor(durationMs / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return `${hours}h ${remainingMinutes}m`;
	}
</script>

{#if totalTasks > 0}
	<AgentToolCard>
		<div class="px-3 py-2 space-y-2">
			<!-- Header with progress -->
			<div class="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
				<div class="flex min-w-0 items-center gap-2">
					<span class="font-medium uppercase tracking-wide">{tasksLabel}</span>
					{#if durationLabel}
						<span class="font-mono text-[10px] text-muted-foreground/70">{durationLabel}</span>
					{/if}
				</div>
				<span class="font-mono">{completedCount}/{totalTasks}</span>
			</div>

			<!-- Progress bar -->
			<div class="h-1 bg-muted rounded-full overflow-hidden">
				<div
					class="h-full bg-primary transition-all duration-300"
					style="width: {progressPercent}%"
				></div>
			</div>

			<!-- Task list -->
			<div class="space-y-0.5">
				{#each todos as todo, index (todo.content)}
					{@const isCurrent = index === inProgressIndex}
					{@const isCurrentAndLive = isCurrent && isLive}
					<div
						class="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-1 py-0.5 rounded text-xs {isCurrent
							? 'bg-muted/30'
							: ''}"
					>
						<!-- Numbered icon -->
						<span class="shrink-0">
							<TodoNumberIcon {index} status={todo.status} {isLive} size={14} />
						</span>

						<!-- Content -->
						<span
							class={todo.status === "completed"
								? "text-muted-foreground/60 line-through"
								: todo.status === "cancelled"
									? "text-muted-foreground/40 line-through"
									: "text-foreground"}
						>
							{#if isCurrentAndLive && todo.activeForm}
								<TextShimmer class="text-xs">{todo.activeForm}</TextShimmer>
							{:else}
								{todo.content}
							{/if}
						</span>

						<!-- Duration -->
						<span class="shrink-0 text-right text-muted-foreground font-mono text-[10px]">
							{formatDuration(todo.duration)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	</AgentToolCard>
{:else}
	<!-- Fallback when no todos parsed -->
	<AgentToolCard>
		<div class="px-3 py-2.5 flex items-center gap-2 text-xs text-muted-foreground">
			<ListChecks size={14} />
			<span>{fallbackLabel}</span>
		</div>
	</AgentToolCard>
{/if}
