<script lang="ts">
import { AgentPanelTodoHeader as SharedAgentPanelTodoHeader } from "@acepe/ui/agent-panel";
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
	/** Compact mode: non-expandable bar only, no copy button or chevron. */
	compact?: boolean;
}

const { sessionId, entries, isConnected, status, isStreaming, compact = false }: Props = $props();

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

const shouldRender = $derived(todoState !== null && todoState.totalCount > 0);

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

</script>

{#if shouldRender && todoState}
	<SharedAgentPanelTodoHeader
		items={todoState.items}
		currentTask={todoState.currentTask}
		completedCount={todoState.completedCount}
		totalCount={todoState.totalCount}
		isLive={todoState.isLive}
		allCompletedLabel={"All tasks completed"}
		pausedLabel={"Tasks paused"}
		{compact}
	>
		{#snippet copyButton()}
			{#if !compact}
				<CopyButton getText={getMarkdown} size={12} variant="icon" class="p-0.5" stopPropagation />
			{/if}
		{/snippet}
	</SharedAgentPanelTodoHeader>
{/if}
