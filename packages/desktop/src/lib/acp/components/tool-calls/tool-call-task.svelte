<script lang="ts">
import { AgentToolTask } from "@acepe/ui/agent-panel";
import { getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { convertTaskChildren } from "./tool-call-task/logic/convert-task-children.js";
import { resolveTaskSubagent } from "./tool-call-task/logic/resolve-task-subagent.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

const sessionStore = getSessionStore();
const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Extract subagent data
const subagent = $derived.by(() => {
	return resolveTaskSubagent(toolCall, sessionStore.getStreamingArguments(toolCall.id));
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

// Convert task children to presentational entries
const children = $derived(
	convertTaskChildren(toolCall.taskChildren, turnState, toolStatus.isSuccess)
);
</script>

<AgentToolTask
	description={subagent?.description ?? null}
	prompt={subagent?.prompt ?? null}
	{resultText}
	{children}
	status={agentStatus}
	showDoneIcon={toolStatus.isSuccess}
	iconBasePath="/svgs/icons"
	durationLabel={elapsedLabel ?? undefined}
	runningFallback={"Running task…"}
	doneFallback={"Task"}
	resultLabel={"Result"}
/>
