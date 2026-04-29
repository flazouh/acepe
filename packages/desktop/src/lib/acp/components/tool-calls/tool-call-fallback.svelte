<script lang="ts">
import type { AgentToolKind } from "@acepe/ui/agent-panel";

import { AgentToolRow } from "@acepe/ui/agent-panel";
import {
	getToolKindFilePath,
	getToolKindSubtitle,
	getToolKindTitle,
} from "../../registry/tool-kind-ui-registry.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { getToolPresentationStatus, getToolStatus } from "../../utils/tool-state-utils.js";
import { toAgentToolKind } from "./tool-kind-to-agent-tool-kind.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	isNested?: boolean;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

// Get the tool kind directly from the toolCall
const resolvedKind = $derived<ToolKind>(toolCall.kind ?? "other");

// Derive computed values from kind-based registry
const toolStatus = $derived(getToolStatus(toolCall, turnState));
const title = $derived(getToolKindTitle(resolvedKind, toolCall, turnState));
const subtitle = $derived(getToolKindSubtitle(resolvedKind, toolCall));
const filePath = $derived(getToolKindFilePath(resolvedKind, toolCall));

const agentKind = $derived<AgentToolKind>(toAgentToolKind(resolvedKind));

// Map tool status to AgentToolStatus
const agentStatus = $derived(getToolPresentationStatus(toolCall, turnState));
</script>

<AgentToolRow
	kind={agentKind}
	{title}
	subtitle={subtitle || undefined}
	filePath={filePath ?? undefined}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	iconBasePath="/svgs/icons"
/>
