<script lang="ts">
import { TextShimmer } from "@acepe/ui/text-shimmer";
import { IconCheck } from "@tabler/icons-svelte";
import { ArrowsInLineVertical, ArrowsOutLineVertical, Package } from "phosphor-svelte";
import * as m from "$lib/messages.js";
import type { ToolCallStatus } from "$lib/services/converted-session-types.js";

import type { ToolStatusResult } from "../../../utils/tool-state-utils.js";

import ToolInterrupted from "../shared/tool-interrupted.svelte";

interface Props {
	/** Tool call status */
	status: ToolCallStatus;
	/** Comprehensive tool status result */
	toolStatus?: ToolStatusResult;
	/** Skill name (e.g., "research", "commit") */
	skillName: string | null;
	/** Skill arguments */
	skillArgs?: string | null;
	/** Whether we have content to show (description, etc.) */
	hasContent?: boolean;
	/** Whether the content view is expanded */
	isExpanded?: boolean;
	/** Callback to toggle expand state */
	onToggleExpand?: () => void;
}

let {
	status,
	toolStatus,
	skillName,
	skillArgs,
	hasContent = false,
	isExpanded = false,
	onToggleExpand,
}: Props = $props();

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

// Format display name
const displayName = $derived(skillName ? `/${skillName}` : null);

// Truncate args for header display
const displayArgs = $derived(
	skillArgs && skillArgs.length > 40 ? `${skillArgs.slice(0, 40)}...` : skillArgs
);
</script>

<!-- If skill name is still being generated (input-streaming state), show simple shimmer -->
{#if effectiveToolStatus.isInputStreaming && !skillName}
	<div class="flex h-7 items-start gap-1.5 rounded-md px-2.5 py-0.5">
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				<span class="shrink-0 whitespace-nowrap font-medium">
					<TextShimmer class="inline-flex h-4 items-center text-xs leading-none">
						Loading skill
					</TextShimmer>
				</span>
			</div>
		</div>
	</div>
{:else if !skillName}
	<!-- No skill name and not streaming = interrupted -->
	<div class="flex h-7 items-center px-2.5">
		<ToolInterrupted toolName="Skill" />
	</div>
{:else}
	<!-- Header - fixed height to prevent layout shift -->
	<div class="flex h-7 items-center justify-between gap-2 px-2.5">
		<!-- Left side: icon + skill name + args -->
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<Package weight="duotone" class="size-3.5 shrink-0 text-primary" />

			{#if effectiveToolStatus.isPending}
				<TextShimmer class="shrink-0 font-mono text-xs font-medium text-foreground">
					{displayName}
				</TextShimmer>
			{:else}
				<span class="shrink-0 font-mono text-xs font-medium text-foreground">
					{displayName}
				</span>
			{/if}

			{#if displayArgs}
				<span class="truncate font-mono text-[10px] text-muted-foreground/70">
					{displayArgs}
				</span>
			{/if}
		</div>

		<!-- Right side: status + expand button -->
		<div class="flex shrink-0 items-center gap-2">
			<!-- Status indicator -->
			<div class="flex items-center gap-1 text-xs text-muted-foreground">
				{#if effectiveToolStatus.isPending}
					<TextShimmer class="text-[10px] uppercase tracking-wide"
						>{m.plan_sidebar_todo_running()}</TextShimmer
					>
				{:else if effectiveToolStatus.isSuccess}
					<IconCheck class="size-3" />
					<span class="text-[10px] uppercase tracking-wide">Done</span>
				{/if}
			</div>

			<!-- Expand/Collapse button - only show when has content -->
			{#if hasContent && onToggleExpand}
				<button
					type="button"
					onclick={onToggleExpand}
					class="expand-button"
					aria-label={isExpanded ? "Collapse" : "Expand"}
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
