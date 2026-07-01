<script lang="ts">
	import { FilePathBadge } from "../file-path-badge/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import { Colors } from "../../lib/colors.js";
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
	}

	let { tool, class: className = "", iconBasePath = "/svgs/icons" }: Props = $props();

	const fileName = $derived(tool.filePath ? (tool.filePath.split("/").pop() || tool.filePath) : null);
	const isSkill = $derived(tool.kind === "skill");
</script>

<div class={`flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground ${className}`.trim()}>
	{#if isSkill}
		<RoundedIcon
			name="skills"
			class="size-3 shrink-0"
			style="color: {Colors.purple}"
		/>
	{/if}

	<ToolLabel status={tool.status}>{tool.title}</ToolLabel>

	{#if tool.filePath && fileName}
		<FilePathBadge
			filePath={tool.filePath}
			{fileName}
			{iconBasePath}
			interactive={false}
			variant="plain"
			class="font-normal text-muted-foreground/60"
		/>
	{/if}

	{#if tool.subtitle}
		<span class="min-w-0 truncate font-normal text-muted-foreground/60">{tool.subtitle}</span>
	{/if}
</div>
