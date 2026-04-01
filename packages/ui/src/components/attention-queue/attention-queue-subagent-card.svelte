<script lang="ts">
	import Robot from "phosphor-svelte/lib/Robot";

	import { Colors } from "../../lib/colors.js";
	import AgentToolRow from "../agent-panel/agent-tool-row.svelte";
	import ToolTally from "../agent-panel/tool-tally.svelte";
	import type { AgentToolEntry, AgentToolKind, AgentToolStatus } from "../agent-panel/types.js";
	import { TextShimmer } from "../text-shimmer/index.js";

	interface Props {
		summary: string;
		isStreaming?: boolean;
		latestTool?: {
			id: string;
			kind?: AgentToolKind;
			title: string;
			filePath?: string;
			status: AgentToolStatus;
		} | null;
		toolCalls?: AgentToolEntry[];
	}

	let { summary, isStreaming = false, latestTool = null, toolCalls = [] }: Props = $props();
</script>

<div
	class="flex w-full min-w-0 flex-col overflow-hidden rounded-sm border border-border/60 bg-accent/30"
	data-testid="queue-subagent-card"
>
	<div class="flex min-w-0 items-center gap-2 px-2 py-1.5 text-xs">
		<Robot size={12} weight="fill" style="color: {Colors.purple}" class="shrink-0" />
		<div class="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground">
			{#if isStreaming}
				<TextShimmer class="block truncate font-medium">{summary}</TextShimmer>
			{:else}
				<span class="block truncate font-medium">{summary}</span>
			{/if}
		</div>
	</div>

	{#if latestTool}
		<div class="border-t border-border py-1.5">
			<AgentToolRow
				title={latestTool.title}
				filePath={latestTool.filePath}
				status={latestTool.status}
				kind={latestTool.kind}
				iconBasePath="/svgs/icons"
			/>
		</div>
	{/if}

	{#if toolCalls.length > 0}
		<ToolTally toolCalls={toolCalls} />
	{/if}
</div>