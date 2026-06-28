<script lang="ts">
	import { FilePathBadge } from "../file-path-badge/index.js";
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
		iconBasePath?: string;
		fileChipClass?: string;
	}

	let {
		tool,
		class: className = "",
		iconBasePath = "/svgs/icons",
		fileChipClass = "font-normal text-muted-foreground/60",
	}: Props = $props();

	const fileName = $derived(tool.filePath ? (tool.filePath.split("/").pop() || tool.filePath) : null);
</script>

<div class={`flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground ${className}`.trim()}>
	<ToolLabel status={tool.status}>{tool.title}</ToolLabel>

	{#if tool.filePath && fileName}
		<FilePathBadge
			filePath={tool.filePath}
			{fileName}
			{iconBasePath}
			interactive={false}
			showIcon={false}
			size="sm"
			variant="plain"
			class={fileChipClass}
		/>
	{/if}

	{#if tool.subtitle}
		<span class="min-w-0 truncate font-normal text-muted-foreground/60">{tool.subtitle}</span>
	{/if}
</div>
