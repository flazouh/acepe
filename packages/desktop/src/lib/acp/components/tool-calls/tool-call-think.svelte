<script lang="ts">
import { AgentToolRow } from "@acepe/ui/agent-panel";
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

// Extract description from think arguments
const description = $derived.by(() => {
	if (toolCall.arguments.kind === "think") {
		return toolCall.arguments.description ?? null;
	}
	return null;
});

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});

const title = $derived(toolCall.title ?? "Thinking");
</script>

<AgentToolRow
	kind="think"
	{title}
	subtitle={description ?? undefined}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	iconBasePath="/svgs/icons"
/>
