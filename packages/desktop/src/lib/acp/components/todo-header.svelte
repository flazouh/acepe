<script lang="ts">
import { TextShimmer, TodoNumberIcon } from "@acepe/ui";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import * as m from "$lib/paraglide/messages.js";
import type { SessionEntry } from "../application/dto/session-entry.js";
import type { SessionStatus } from "../application/dto/session-status.js";
import type { ThreadWithEntries } from "../logic/todo-state.svelte.js";

import { getTodoStateManager } from "../logic/todo-state-manager.svelte.js";
import AnimatedChevron from "./animated-chevron.svelte";
import CopyButton from "./messages/copy-button.svelte";

interface Props {
	sessionId: string | null;
	entries: ReadonlyArray<SessionEntry>;
	isConnected: boolean;
	status: SessionStatus;
	isStreaming: boolean;
}

const { sessionId, entries, isConnected, status, isStreaming }: Props = $props();

const manager = getTodoStateManager();

const todoState = $derived.by(() => {
	if (!sessionId) return null;

	const threadData: ThreadWithEntries = {
		entries,
		isConnected,
		status,
		isStreaming,
	};
	const result = manager.getTodoState(sessionId, threadData);
	if (result.isOk()) {
		return result.value;
	} else {
		console.error("Failed to create todo state:", result.error);
		return null;
	}
});

// Expanded by default
let isExpanded = $state(true);

const shouldRender = $derived(todoState !== null && todoState.totalCount > 0);

const progressPercent = $derived(
	todoState && todoState.totalCount > 0
		? Math.round((todoState.completedCount / todoState.totalCount) * 100)
		: 0
);

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

function getMarkdown(): string {
	if (!todoState) return "";
	const header = `| # | Task | Status | Duration |`;
	const separator = `|---|------|--------|----------|`;
	const rows = todoState.items.map((todo, index) => {
		const num = index + 1;
		const todoStatus =
			todo.status === "completed"
				? "Done"
				: todo.status === "in_progress"
					? "Running"
					: todo.status === "cancelled"
						? "Cancelled"
						: "Pending";
		const duration = formatDuration(todo.duration);
		return `| ${num} | ${todo.content} | ${todoStatus} | ${duration} |`;
	});
	return [header, separator, ...rows].join("\n");
}

function toggleExpanded() {
	isExpanded = !isExpanded;
}
</script>

{#if shouldRender && todoState}
	<div class="w-full px-5 mb-2">
		<!-- Expanded Task Table (above the bar, expanding upward) -->
		{#if isExpanded}
			<div class="rounded-t-md bg-muted/30 overflow-hidden border border-b-0 border-border">
				<div class="flex flex-col max-h-[300px] overflow-y-auto">
					<!-- Compact markdown-table-style rows -->
					{#each todoState.items as item, index (index)}
						{@const isInProgress = item.status === "in_progress"}
						{@const duration = formatDuration(item.duration)}
						<div
							class="flex items-center gap-2 px-3 py-1 text-[0.6875rem] leading-tight border-b border-border/30 last:border-b-0 {isInProgress
								? 'bg-muted/30'
								: ''}"
						>
							<!-- Status icon -->
							<span class="shrink-0">
								<TodoNumberIcon {index} status={item.status} isLive={todoState.isLive} size={12} />
							</span>

							<!-- Task content -->
							{#if isInProgress && todoState.isLive}
								<TextShimmer class="flex-1 truncate text-foreground text-[0.6875rem]">
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

							<!-- Duration -->
							{#if duration}
								<span class="shrink-0 text-muted-foreground font-mono text-[0.625rem]">
									{duration}
								</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Collapsed Header Bar (same style as modified-files-header) -->
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
			class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors cursor-pointer {isExpanded
				? 'rounded-t-none border-t-0'
				: ''}"
		>
			<div class="flex items-center gap-1.5 text-[0.6875rem] min-w-0">
				{#if todoState.isLive && todoState.currentTask}
					<TextShimmer class="text-foreground font-medium truncate text-[0.6875rem]">
						{todoState.currentTask.activeForm ?? todoState.currentTask.content}
					</TextShimmer>
				{:else if todoState.currentTask}
					<span class="text-muted-foreground truncate">
						{todoState.currentTask.content}
					</span>
				{:else if todoState.completedCount === todoState.totalCount}
					<CheckCircle class="size-3 text-success shrink-0" weight="fill" />
					<span class="text-muted-foreground">{m.todo_all_completed()}</span>
				{:else}
					<span class="text-muted-foreground">{m.todo_tasks_paused()}</span>
				{/if}
			</div>

			<div class="flex items-center gap-1.5 shrink-0">
				<!-- Progress indicator -->
				<span class="text-[0.6875rem] text-muted-foreground">
					{todoState.completedCount}/{todoState.totalCount}
				</span>

				<!-- Mini progress bar -->
				<div class="w-8 h-1 bg-muted rounded-full overflow-hidden">
					<div
						class="h-full bg-primary transition-all duration-300"
						style="width: {progressPercent}%"
					></div>
				</div>

				<CopyButton getText={getMarkdown} size={12} variant="icon" class="p-0.5" stopPropagation />

				<!-- Expand/collapse chevron -->
				<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground" />
			</div>
		</div>
	</div>
{/if}
