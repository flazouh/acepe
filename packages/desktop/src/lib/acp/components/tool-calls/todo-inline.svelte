<script lang="ts">
import { AgentToolCard } from "@acepe/ui/agent-panel";
import ListChecks from "phosphor-svelte/lib/ListChecks";
import * as Table from "$lib/components/ui/table/index.js";
import * as m from "$lib/paraglide/messages.js";

import type { ToolCall } from "../../types/tool-call.js";
import CopyButton from "../messages/copy-button.svelte";
import TodoStatusBadge from "../todo-status-badge.svelte";

interface Props {
	toolCall: ToolCall;
	isLive: boolean;
}

let { toolCall, isLive }: Props = $props();

// Use normalizedTodos from the backend (parsed by Rust streaming accumulator)
const todos = $derived(toolCall.normalizedTodos ?? []);
const totalTasks = $derived(todos.length);
const completedCount = $derived(todos.filter((t) => t.status === "completed").length);
const inProgressIndex = $derived(todos.findIndex((t) => t.status === "in_progress"));
const progressPercent = $derived(
	totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0
);

/**
 * Format duration in milliseconds to human-readable string.
 */
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

function getMarkdown(): string {
	const header = `| # | Task | Status | Duration |`;
	const separator = `|---|------|--------|----------|`;
	const rows = todos.map((todo, index) => {
		const num = index + 1;
		const status =
			todo.status === "completed"
				? "✅ Done"
				: todo.status === "in_progress"
					? "🔄 Running"
					: todo.status === "cancelled"
						? "❌ Cancelled"
						: "⏳ Pending";
		const duration = formatDuration(todo.duration);
		return `| ${num} | ${todo.content} | ${status} | ${duration} |`;
	});
	return [header, separator, ...rows].join("\n");
}
</script>

{#if totalTasks > 0}
	<AgentToolCard>
		<div class="px-3 py-2 space-y-2">
			<!-- Header with progress -->
			<div class="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
				<span class="font-medium uppercase tracking-wide">{m.todo_heading()}</span>
				<div class="flex items-center gap-2">
					<span class="font-mono">{completedCount}/{totalTasks}</span>
					<CopyButton getText={getMarkdown} size={12} variant="icon" class="p-1" />
				</div>
			</div>

			<!-- Progress bar -->
			<div class="h-1 bg-muted rounded-full overflow-hidden">
				<div
					class="h-full bg-primary transition-all duration-300"
					style="width: {progressPercent}%"
				></div>
			</div>

			<!-- Task table using shadcn table components -->
			<Table.Root class="text-xs">
				<Table.Body>
					{#each todos as todo, index (todo.content)}
						{@const isCurrent = index === inProgressIndex}
						{@const isCurrentAndLive = isCurrent && isLive}
						<Table.Row class={isCurrent ? "bg-muted/30" : ""}>
							<Table.Cell class="text-muted-foreground font-mono">{index + 1}</Table.Cell>
							<Table.Cell
								class={todo.status === "completed"
									? "text-muted-foreground/60 line-through"
									: todo.status === "cancelled"
										? "text-muted-foreground/40 line-through"
										: "text-foreground"}
							>
								{#if isCurrentAndLive && todo.activeForm}
									{todo.activeForm}
								{:else}
									{todo.content}
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<TodoStatusBadge status={todo.status} {isLive} />
							</Table.Cell>
							<Table.Cell class="text-right text-muted-foreground font-mono">
								{formatDuration(todo.duration)}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	</AgentToolCard>
{:else}
	<!-- Fallback when no todos parsed (shouldn't happen normally) -->
	<AgentToolCard>
		<div class="px-3 py-2.5 flex items-center gap-2 text-xs text-muted-foreground">
			<ListChecks class="size-3.5" />
			<span>Updated todos</span>
		</div>
	</AgentToolCard>
{/if}
