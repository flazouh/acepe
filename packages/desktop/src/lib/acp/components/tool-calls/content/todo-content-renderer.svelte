<script lang="ts">
import { TextShimmer, TodoNumberIcon } from "@acepe/ui";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";

import type { TodoContent } from "../../../schemas/tool-call-content.schema.js";

interface Props {
	content: TodoContent;
	/**
	 * Whether the session is currently active (streaming/connected).
	 * When false, in_progress items show as paused instead of running.
	 */
	isLive?: boolean;
}

let { content, isLive = true }: Props = $props();

// Find the current in-progress task (only considered active if session is live)
const currentTask = $derived(isLive ? content.todos.find((t) => t.status === "in_progress") : null);

// Calculate progress
const completedCount = $derived(content.todos.filter((t) => t.status === "completed").length);
const totalCount = $derived(content.todos.length);
</script>

<div class="rounded-md border bg-card overflow-hidden">
	<!-- Header with current task -->
	{#if currentTask}
		<div class="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
			<TextShimmer class="text-xs font-medium truncate">
				{currentTask.activeForm ?? currentTask.content}
			</TextShimmer>
			<span class="text-xs text-muted-foreground ml-auto">
				{completedCount} of {totalCount}
			</span>
		</div>
	{:else}
		<div class="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
			<CheckCircle class="size-3.5 text-success" weight="fill" />
			<span class="text-xs font-medium text-foreground">Tasks</span>
			<span class="text-xs text-muted-foreground ml-auto">
				{completedCount} of {totalCount} completed
			</span>
		</div>
	{/if}

	<!-- Task list -->
	<div class="divide-y divide-border/50">
		{#each content.todos as todo, index (todo.content)}
			{@const itemIsRunning = todo.status === "in_progress" && isLive}
			<div class="flex items-start gap-2 px-3 py-2 text-xs">
				<span class="mt-0.5 shrink-0">
					<TodoNumberIcon {index} status={todo.status} {isLive} size={14} />
				</span>
				{#if itemIsRunning}
					<TextShimmer class="flex-1 text-foreground text-xs">
						{todo.content}
					</TextShimmer>
				{:else}
					<span
						class="flex-1"
						class:text-foreground={todo.status !== "completed"}
						class:text-muted-foreground={todo.status === "completed"}
						class:line-through={todo.status === "completed"}
					>
						{todo.content}
					</span>
				{/if}
			</div>
		{/each}
	</div>
</div>
