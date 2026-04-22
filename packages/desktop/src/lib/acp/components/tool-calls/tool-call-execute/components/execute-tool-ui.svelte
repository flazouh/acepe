<script lang="ts">
import { AgentToolCard } from "@acepe/ui/agent-panel";
import { CodeBlock } from "$lib/components/ui/code-block";
import { getSessionStore } from "../../../../store/index.js";
import type { TurnState } from "../../../../store/types.js";
import type { ToolCall } from "../../../../types/tool-call.js";
import { stripAnsiCodes } from "../../../../utils/ansi-utils.js";
import { getToolStatus } from "../../../../utils/tool-state-utils.js";
import ToolContentModal from "../../tool-content-modal.svelte";
import { resolveExecuteCommand } from "../logic/resolve-execute-command.js";
import { ExecuteToolUIState } from "../state/execute-tool-ui-state.svelte.js";
import {
	resolveExecuteDisplayResult,
	resolveExecuteFallbackOutputText,
} from "../../tool-result-display.js";
import ExecuteToolContent from "./execute-tool-content.svelte";
import ExecuteToolHeader from "./execute-tool-header.svelte";

interface ExecuteToolUIProps {
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
}

let { toolCall, turnState }: ExecuteToolUIProps = $props();

// Get comprehensive tool status (includes interrupt detection)
const toolStatus = $derived(getToolStatus(toolCall, turnState));

const sessionStore = getSessionStore();

// Use state class for UI state management
const uiState = new ExecuteToolUIState();

// Extract command: streaming args → typed arguments → backtick title
const extractedCommand = $derived(
	resolveExecuteCommand(
		sessionStore.getStreamingArguments(toolCall.id),
		toolCall.arguments,
		toolCall.title
	)
);

// Parse result with stdout, stderr, and exit code (like 1code)
const parsedResult = $derived(resolveExecuteDisplayResult(toolCall));

const stdout = $derived(parsedResult.stdout);
const stderr = $derived(parsedResult.stderr);
const exitCode = $derived(parsedResult.exitCode);
const fallbackOutput = $derived(resolveExecuteFallbackOutputText(toolCall));

// Determine if we have any output
const hasOutput = $derived(stdout !== null || stderr !== null);

// Show content when we have a command to display (even while running) or output (after completion)
const hasContent = $derived(extractedCommand !== null || hasOutput);

function handleToggleExpand() {
	uiState.toggleCollapse();
}

function handleClickExpand() {
	if (uiState.isCollapsed) {
		uiState.toggleCollapse();
	}
}

function handleCloseModal() {
	uiState.closeModal();
}

const modalDisplayOutput = $derived.by(() => {
	// Combine stdout and stderr for modal display
	let output = "";
	if (stdout) {
		output += stripAnsiCodes(stdout);
	}
	if (stderr) {
		if (output) output += "\n";
		output += stripAnsiCodes(stderr);
	}
	if (output) return output;

	if (fallbackOutput) {
		return stripAnsiCodes(fallbackOutput);
	}

	return null;
});
</script>

<!-- Like 1code: show simple text when streaming without command, otherwise show card -->
{#if toolStatus.isInputStreaming && !extractedCommand}
	<ExecuteToolHeader
		status={toolCall.status}
		{toolStatus}
		command={extractedCommand}
		{hasOutput}
		{exitCode}
		isExpanded={!uiState.isCollapsed}
		onToggleExpand={handleToggleExpand}
	/>
{:else}
	<AgentToolCard>
		<ExecuteToolHeader
			status={toolCall.status}
			{toolStatus}
			command={extractedCommand}
			{hasOutput}
			{exitCode}
			isExpanded={!uiState.isCollapsed}
			onToggleExpand={handleToggleExpand}
		/>

		{#if hasContent}
			<ExecuteToolContent
				command={extractedCommand}
				{stdout}
				{stderr}
				{exitCode}
				{fallbackOutput}
				isExpanded={!uiState.isCollapsed}
				onClickExpand={handleClickExpand}
			/>
		{/if}
	</AgentToolCard>
{/if}

<ToolContentModal bind:isOpen={uiState.isModalOpen} onClose={handleCloseModal} {toolCall}>
	{#snippet title()}
		<div class="text-sm font-medium">Execute Tool Output</div>
	{/snippet}

	<div class="flex flex-col gap-4">
		<!-- Command Card -->
		<div class="modal-command-card">
			<div class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
				<span class="text-xs font-medium text-muted-foreground">Command</span>
			</div>
			<div class="p-3">
				<div class="flex items-center gap-2 font-mono text-sm">
					<span class="text-amber-600 dark:text-amber-400">$</span>
					<span class="whitespace-pre-wrap break-all text-foreground"
						>{extractedCommand || "Command"}</span
					>
				</div>
			</div>
		</div>

		<!-- Output Card -->
		{#if modalDisplayOutput}
			<div class="modal-output-card">
				<div class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
					<span class="text-xs font-medium text-muted-foreground">Output</span>
				</div>
				<div class="p-3">
					<CodeBlock content={modalDisplayOutput} showLineNumbers={true} />
				</div>
			</div>
		{/if}
	</div>
</ToolContentModal>

<style>
	.modal-command-card,
	.modal-output-card {
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		overflow: hidden;
		background-color: var(--card);
	}
</style>
