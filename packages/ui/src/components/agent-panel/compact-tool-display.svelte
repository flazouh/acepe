<script lang="ts">
	import { FilePathBadge } from "../file-path-badge/index.js";
	import { TextShimmer } from "../text-shimmer/index.js";
	import PermissionBarIcon from "./permission-bar-icon.svelte";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolKind, AgentToolStatus } from "./types.js";

	interface Props {
		tool: {
			id: string;
			kind?: AgentToolKind;
			title: string;
			subtitle?: string;
			filePath?: string;
			status: AgentToolStatus;
		};
		class?: string;
		iconSize?: number;
		iconBasePath?: string;
		fileChipClass?: string;
	}

	let {
		tool,
		class: className = "",
		iconSize = 10,
		iconBasePath = "/svgs/icons",
		fileChipClass = "font-normal text-muted-foreground/60",
	}: Props = $props();

	const fileName = $derived(tool.filePath ? (tool.filePath.split("/").pop() || tool.filePath) : null);
	const isPending = $derived(tool.status === "pending" || tool.status === "running");
</script>

<div class={`flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground ${className}`.trim()}>
	{#if tool.kind}
		<PermissionBarIcon kind={tool.kind} color="var(--token-plan-icon-dark)" size={iconSize} />
	{/if}

	{#if tool.filePath && fileName}
		<ToolLabel status={tool.status}>{tool.title}</ToolLabel>
		<FilePathBadge
			filePath={tool.filePath}
			{fileName}
			{iconBasePath}
			interactive={false}
			size="sm"
			class={fileChipClass}
		/>
	{:else if tool.subtitle}
		<span class="min-w-0 truncate font-normal text-muted-foreground/60">{tool.subtitle}</span>
	{:else}
		<span class="min-w-0 truncate">
			{#if isPending}
				<TextShimmer class="truncate">{tool.title}</TextShimmer>
			{:else}
				{tool.title}
			{/if}
		</span>
	{/if}
</div>
