<script lang="ts">
import { AgentToolTodo } from "@acepe/ui/agent-panel";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";

import { getToolStatus } from "../../utils/tool-state-utils.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

// Compute isLive from tool status and turn state
const toolStatus = $derived(getToolStatus(toolCall, turnState));
const isLive = $derived(toolStatus.isPending && turnState === "streaming");

// Use normalizedTodos from the backend (parsed by Rust streaming accumulator)
const todos = $derived(toolCall.normalizedTodos ?? []);
</script>

<AgentToolTodo
	{todos}
	{isLive}
	durationLabel={elapsedLabel ?? undefined}
	tasksLabel={"Tasks"}
	fallbackLabel={"Updated todos"}
/>
