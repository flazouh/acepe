<script lang="ts">
import { AgentToolExecute } from "@acepe/ui/agent-panel";
import { splitCommandSegments } from "@acepe/ui/bash-tokenizer";
import * as m from "$lib/messages.js";
import { getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { stripAnsiCodes } from "../../utils/ansi-utils.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { bashHighlighter } from "../../utils/bash-highlighter.svelte.js";
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

// Shiki bash highlighting — bashHighlighter.ready is reactive ($state)
const commandHtmls = $derived(
	bashHighlighter.ready && extractedCommand
		? splitCommandSegments(extractedCommand)
				.map((s) => bashHighlighter.highlight(s))
				.filter((h): h is string => h !== null)
		: []
);

const strippedStdout = $derived(
	parsedResult.stdout ? stripAnsiCodes(parsedResult.stdout) : null
);
const strippedStderr = $derived(
	parsedResult.stderr ? stripAnsiCodes(parsedResult.stderr) : null
);

const stdoutHtml = $derived(
	bashHighlighter.ready && strippedStdout
		? (bashHighlighter.highlightOutput(strippedStdout) ?? undefined)
		: undefined
);
const stderrHtml = $derived(
	bashHighlighter.ready && strippedStderr
		? (bashHighlighter.highlightOutput(strippedStderr) ?? undefined)
		: undefined
);
</script>

<AgentToolExecute
	command={extractedCommand}
	stdout={strippedStdout}
	stderr={strippedStderr}
	{stdoutHtml}
	{stderrHtml}
	exitCode={parsedResult.exitCode}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	{commandHtmls}
	runningLabel={m.tool_bash_running_no_cmd()}
	finishedLabel={agentStatus === "error" ? m.tool_bash_failed() : m.tool_bash_success()}
	ariaCollapseOutput={m.aria_collapse_output()}
	ariaExpandOutput={m.aria_expand_output()}
/>
