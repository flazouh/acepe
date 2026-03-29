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
import { getToolStatus } from "../../utils/tool-state-utils.js";

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

// Map desktop ToolKind to shared AgentToolKind
const SHARED_KINDS = new Set<string>([
	"read",
	"edit",
	"write",
	"execute",
	"search",
	"fetch",
	"web_search",
	"think",
	"task",
	"other",
]);

const agentKind = $derived<AgentToolKind>(
	SHARED_KINDS.has(resolvedKind) ? (resolvedKind as AgentToolKind) : "other"
);

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});
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
