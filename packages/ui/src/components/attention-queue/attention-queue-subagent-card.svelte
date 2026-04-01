<script lang="ts">
	import BookOpenText from "phosphor-svelte/lib/BookOpenText";
	import Lightning from "phosphor-svelte/lib/Lightning";
	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
	import Package from "phosphor-svelte/lib/Package";
	import PencilSimple from "phosphor-svelte/lib/PencilSimple";
	import Robot from "phosphor-svelte/lib/Robot";
	import Terminal from "phosphor-svelte/lib/Terminal";

	import { Colors } from "../../lib/colors.js";
	import { FilePathBadge } from "../file-path-badge/index.js";
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

	const toolKind = $derived(latestTool ? latestTool.kind : undefined);
	const iconColor = $derived.by(() => {
		if (toolKind === "task" || toolKind === "think") {
			return Colors.purple;
		}

		return "var(--muted-foreground)";
	});
</script>

<div
	class="flex w-full min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1"
	data-testid="queue-subagent-card"
>
	<div class="flex min-w-0 items-center gap-1.5">
		{#if toolKind === "read"}
			<BookOpenText size={10} weight="fill" style="color: {iconColor}" class="shrink-0" />
		{:else if toolKind === "edit" || toolKind === "write"}
			<PencilSimple size={10} weight="fill" style="color: {iconColor}" class="shrink-0" />
		{:else if toolKind === "execute"}
			<Terminal size={10} weight="fill" style="color: {iconColor}" class="shrink-0" />
		{:else if toolKind === "search"}
			<MagnifyingGlass size={10} weight="fill" style="color: {iconColor}" class="shrink-0" />
		{:else if toolKind === "fetch" || toolKind === "web_search"}
			<Lightning size={10} weight="fill" style="color: {iconColor}" class="shrink-0" />
		{:else if toolKind === "task_output" || toolKind === "other"}
			<Package size={10} weight="fill" style="color: {iconColor}" class="shrink-0" />
		{:else}
			<Robot size={10} weight="fill" style="color: {iconColor}" class="shrink-0" />
		{/if}

		{#if latestTool?.filePath}
			<div class="min-w-0 flex-1">
				<FilePathBadge
					filePath={latestTool.filePath}
					iconBasePath="/svgs/icons"
					interactive={false}
					size="sm"
				/>
			</div>
		{:else}
			<div class="min-w-0 flex-1 font-mono text-[10px] text-muted-foreground">
				{#if isStreaming}
					<TextShimmer class="block truncate">{summary}</TextShimmer>
				{:else}
					<span class="block truncate">{summary}</span>
				{/if}
			</div>
		{/if}
	</div>

	{#if toolCalls.length > 0}
		<ToolTally toolCalls={toolCalls} inline />
	{/if}
</div>