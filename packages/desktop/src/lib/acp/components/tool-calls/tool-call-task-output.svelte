<script lang="ts">
import { AgentToolTask } from "@acepe/ui/agent-panel";
import * as m from "$lib/paraglide/messages.js";
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

const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Extract task_id from the TaskOutput arguments
const taskId = $derived.by(() => {
	if (toolCall.arguments.kind === "taskOutput") {
		return toolCall.arguments.task_id ?? null;
	}
	return null;
});

// Build a description from the task_id
const description = $derived.by(() => {
	if (taskId) return `Task: ${taskId}`;
	return toolStatus.isPending ? m.tool_task_output_running() : m.tool_task_output_completed();
});

// Get the result as a string
const resultText = $derived.by(() => {
	if (!toolCall.result) return null;
	if (typeof toolCall.result === "string") return toolCall.result;
	return null;
});

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});
</script>

<AgentToolTask
	{description}
	prompt={null}
	{resultText}
	children={[]}
	status={agentStatus}
	iconBasePath="/svgs/icons"
	durationLabel={elapsedLabel ?? undefined}
	runningFallback={m.tool_task_output_running()}
	doneFallback={m.tool_task_output_completed()}
	resultLabel={m.tool_task_output_completed()}
/>
