<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import IconCheck from "@tabler/icons-svelte/icons/check";
import IconX from "@tabler/icons-svelte/icons/x";
import ArrowsInLineVertical from "phosphor-svelte/lib/ArrowsInLineVertical";
import ArrowsOutLineVertical from "phosphor-svelte/lib/ArrowsOutLineVertical";
import type { ToolCallStatus } from "$lib/services/converted-session-types.js";

import type { ToolStatusResult } from "../../../../utils/tool-state-utils.js";

import ToolInterrupted from "../../shared/tool-interrupted.svelte";

interface ExecuteToolHeaderProps {
	/** Tool call status */
	status: ToolCallStatus;
	/** Comprehensive tool status result */
	toolStatus?: ToolStatusResult;
	/** The command to display */
	command: string | null;
	/** Whether we have output to show */
	hasOutput?: boolean;
	/** Exit code from command execution */
	exitCode?: number;
	/** Whether the content view is collapsed */
	isExpanded?: boolean;
	/** Callback to toggle collapse state */
	onToggleExpand?: () => void;
}

let {
	status,
	toolStatus,
	command,
	hasOutput = false,
	exitCode,
	isExpanded = false,
	onToggleExpand,
}: ExecuteToolHeaderProps = $props();

// Create a fallback toolStatus if not provided
const effectiveToolStatus = $derived<ToolStatusResult>(
	toolStatus ?? {
		isPending: status === "in_progress" || status === "pending",
		isInputStreaming: false,
		isInterrupted: false,
		isSuccess: status === "completed",
		isError: status === "failed",
	}
);

// For bash tools, success/error is determined by exitCode, not by state
// exitCode 0 = success, anything else (or undefined if no output yet) = error
const isSuccess = $derived(exitCode === 0);
const isError = $derived(exitCode !== undefined && exitCode !== 0);

// Extract command summary - first word of each command in a pipeline (like 1code)
function extractCommandSummary(cmd: string): string {
	// Normalize line continuations (backslash + newline) into single line
	const normalizedCommand = cmd.replace(/\\\s*\n\s*/g, " ");
	const parts = normalizedCommand.split(/\s*(?:&&|\|\||;|\|)\s*/);
	const firstWords = parts.map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
	// Limit to first 4 commands to keep it concise
	const limited = firstWords.slice(0, 4);
	if (firstWords.length > 4) {
		return `${limited.join(", ")}...`;
	}
	return limited.join(", ");
}

const commandSummary = $derived(command ? extractCommandSummary(command) : "");
</script>

<!-- If command is still being generated (input-streaming state), show simple shimmer -->
{#if effectiveToolStatus.isInputStreaming && !command}
	<div class="flex h-7 items-start gap-1.5 rounded-md px-2 py-0.5">
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				<span class="shrink-0 whitespace-nowrap font-medium">
					<TextShimmer class="inline-flex h-4 items-center text-xs leading-none">
						Generating command
					</TextShimmer>
				</span>
			</div>
		</div>
	</div>
{:else if !command && effectiveToolStatus.isInterrupted}
	<!-- No command and explicitly interrupted = show interrupted state -->
	<div class="flex h-7 items-center px-2.5">
		<ToolInterrupted toolName="Command" />
	</div>
{:else if !command && effectiveToolStatus.isPending}
	<!-- No command yet but still pending - show loading shimmer -->
	<div class="flex h-7 items-start gap-1.5 rounded-md px-2 py-0.5">
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				<span class="shrink-0 whitespace-nowrap font-medium">
					<TextShimmer class="inline-flex h-4 items-center text-xs leading-none">
						Running command
					</TextShimmer>
				</span>
			</div>
		</div>
	</div>
{:else if !command}
	<!-- No command and completed - nothing to show (edge case) -->
	<div class="flex h-7 items-center px-2.5">
		<span class="text-xs text-muted-foreground">Command completed</span>
	</div>
{:else}
	<!-- Header - fixed height to prevent layout shift (1code style) -->
	<div class="flex h-7 items-center justify-between px-2.5">
		<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
			{#if effectiveToolStatus.isPending}
				<TextShimmer class="inline-flex items-center text-xs leading-none">
					Running command:
				</TextShimmer>
			{:else}
				Ran command:
			{/if}
			{commandSummary}
		</span>

		<!-- Status and expand button -->
		<div class="ml-2 flex shrink-0 items-center gap-2">
			<!-- Status - min-width ensures no layout shift -->
			<div class="flex min-w-[60px] items-center justify-end gap-1 text-xs text-muted-foreground">
				{#if isSuccess}
					<IconCheck class="size-3" />
					<span>Success</span>
				{:else if isError}
					<IconX class="size-3" />
					<span>Failed</span>
				{/if}
			</div>

			<!-- Expand/Collapse button - only show when not pending and has output -->
			{#if !effectiveToolStatus.isPending && hasOutput && onToggleExpand}
				<button
					type="button"
					onclick={onToggleExpand}
					class="expand-button"
					aria-label={isExpanded ? "Collapse output" : "Expand output"}
				>
					<div class="relative size-4">
						<div
							class="absolute inset-0 transition-[opacity,transform] duration-200 ease-out {isExpanded
								? 'scale-75 opacity-0'
								: 'scale-100 opacity-100'}"
						>
							<ArrowsOutLineVertical weight="fill" class="size-4 text-muted-foreground" />
						</div>
						<div
							class="absolute inset-0 transition-[opacity,transform] duration-200 ease-out {isExpanded
								? 'scale-100 opacity-100'
								: 'scale-75 opacity-0'}"
						>
							<ArrowsInLineVertical weight="fill" class="size-4 text-muted-foreground" />
						</div>
					</div>
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.expand-button {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border-radius: 0.375rem;
		background-color: transparent;
		border: none;
		color: hsl(var(--muted-foreground));
		cursor: pointer;
		transition:
			background-color 0.15s ease-out,
			transform 0.15s ease-out;
	}

	.expand-button:hover {
		background-color: hsl(var(--accent));
	}

	.expand-button:active {
		transform: scale(0.95);
	}

	.expand-button:focus-visible {
		outline: 2px solid hsl(var(--ring));
		outline-offset: 2px;
	}
</style>
