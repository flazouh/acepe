<script lang="ts">
import { AgentToolExecute } from "@acepe/ui/agent-panel";
import * as m from "$lib/paraglide/messages.js";
import { getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { stripAnsiCodes } from "../../utils/ansi-utils.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { parseToolResultWithExitCode } from "./tool-call-execute/logic/parse-tool-result.js";
import { resolveExecuteCommand } from "./tool-call-execute/logic/resolve-execute-command.js";

interface ToolCallExecuteProps {
	/**
	 * The tool call to display.
	 */
	toolCall: ToolCall;
	/**
	 * Turn state for dynamic UI updates.
	 */
	turnState?: TurnState;
	/**
	 * Project path for opening files in panels.
	 */
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: ToolCallExecuteProps = $props();

const sessionStore = getSessionStore();
const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Extract command: streaming args → typed arguments → backtick title
const extractedCommand = $derived(
	resolveExecuteCommand(
		sessionStore.getStreamingArguments(toolCall.id),
		toolCall.arguments,
		toolCall.title
	)
);

// Parse result with stdout, stderr, and exit code
const parsedResult = $derived(parseToolResultWithExitCode(toolCall.result));

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});
</script>

<AgentToolExecute
	command={extractedCommand}
	stdout={parsedResult.stdout ? stripAnsiCodes(parsedResult.stdout) : null}
	stderr={parsedResult.stderr ? stripAnsiCodes(parsedResult.stderr) : null}
	exitCode={parsedResult.exitCode}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	runningNoCmdLabel={m.tool_bash_running_no_cmd()}
	runningLabel={m.tool_bash_running_label()}
	doneLabel={m.tool_bash_completed_label()}
	successLabel={m.tool_bash_success()}
	failedLabel={m.tool_bash_failed()}
	ariaCollapseOutput={m.aria_collapse_output()}
	ariaExpandOutput={m.aria_expand_output()}
/>
