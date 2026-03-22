<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import type { Snippet } from "svelte";

import type { ToolStatusResult } from "../../../utils/tool-state-utils.js";

import AnimatedChevron from "../../animated-chevron.svelte";
import ToolInterrupted from "./tool-interrupted.svelte";

interface Props {
	/** Tool status result from getToolStatus() */
	toolStatus: ToolStatusResult;
	/** Main title text */
	title: string;
	/** Optional subtitle text */
	subtitle?: string;
	/** Tool name for interrupted state */
	toolName: string;
	/** Whether content is collapsed */
	isCollapsed?: boolean;
	/** Show chevron for collapse toggle */
	showChevron?: boolean;
	/** Callback for collapse toggle */
	onToggleCollapse?: () => void;
	/** Optional trailing content */
	trailing?: Snippet;
}

let {
	toolStatus,
	title,
	subtitle,
	toolName,
	isCollapsed = false,
	showChevron = false,
	onToggleCollapse,
	trailing,
}: Props = $props();
</script>

<!-- Fixed height header (h-7 = 28px) to prevent layout shift -->
<div class="flex h-7 min-w-0 items-center gap-2 px-2.5 text-xs">
	<!-- Chevron for collapsible tools -->
	{#if showChevron && onToggleCollapse}
		<button
			type="button"
			onclick={onToggleCollapse}
			class="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded transition-colors hover:bg-muted"
			aria-label={isCollapsed ? "Expand" : "Collapse"}
		>
			<AnimatedChevron isOpen={!isCollapsed} class="size-3 text-muted-foreground" />
		</button>
	{/if}

	<!-- Title and subtitle -->
	<div class="flex min-w-0 flex-1 items-center gap-1.5">
		{#if toolStatus.isInterrupted}
			<ToolInterrupted {toolName} {subtitle} />
		{:else if toolStatus.isPending || toolStatus.isInputStreaming}
			<TextShimmer class="font-medium text-foreground">
				{title}
			</TextShimmer>
		{:else}
			<span class="font-medium text-foreground">{title}</span>
		{/if}

		{#if subtitle && !toolStatus.isInterrupted}
			<span class="truncate text-muted-foreground">{subtitle}</span>
		{/if}
	</div>

	<!-- Trailing content slot -->
	{#if trailing}
		{@render trailing()}
	{/if}
</div>
