<script lang="ts">
import { AgentPanelTodoHeader as SharedAgentPanelTodoHeader } from "@acepe/ui/agent-panel";
import type { SessionStatus } from "../application/dto/session-status.js";
import type { ToolCall } from "../types/tool-call.js";

import { getTodoStateManager } from "../logic/todo-state-manager.svelte.js";

interface Props {
	sessionId: string | null;
	toolCalls: ReadonlyArray<ToolCall>;
	isConnected: boolean;
	status: SessionStatus;
	isStreaming: boolean;
	/** Compact mode: non-expandable bar only, no copy button or chevron. */
	compact?: boolean;
}

const { sessionId, toolCalls, isConnected, status, isStreaming, compact = false }: Props = $props();

const manager = getTodoStateManager();

const todoState = $derived.by(() => {
	if (!sessionId) return null;

	const threadData = {
		toolCalls,
		isConnected,
		status,
		isStreaming,
	};
	const result = manager.getTodoStateFromToolCalls(sessionId, threadData);
	if (result.isOk()) {
		return result.value;
	} else {
		console.error("Failed to create todo state:", result.error);
		return null;
	}
});

const shouldRender = $derived(todoState !== null && todoState.totalCount > 0);
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
	/>
{/if}
