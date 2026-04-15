<script lang="ts">
	import { FilePathBadge } from "../file-path-badge/index.js";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		title: string;
		subtitle?: string;
		filePath?: string;
		status?: AgentToolStatus;
		durationLabel?: string;
		padded?: boolean;
		/** Base path for file type SVG icons (e.g. "/svgs/icons") */
		iconBasePath?: string;
		/** Tool kind (e.g. "edit", "think") for styling or analytics; optional. */
		kind?: string;
	}

	let {
		title,
		subtitle,
		filePath,
		status = "done",
		durationLabel,
		padded = false,
		iconBasePath = "",
	}: Props = $props();

	const fileName = $derived(filePath ? (filePath.split("/").pop() || filePath) : null);
</script>

<div class="flex items-start gap-1.5 {padded ? 'px-2' : ''}">
	<div class="flex min-w-0 flex-1 items-center gap-1.5">
		<div class="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
			<!-- Title -->
			<ToolLabel {status}>{title}</ToolLabel>

			<!-- File chip -->
			{#if filePath && fileName}
				<FilePathBadge
					{filePath}
					fileName={fileName}
					{iconBasePath}
					interactive={false}
					class="font-normal text-muted-foreground/60"
				/>
			{:else if subtitle}
				<span class="min-w-0 truncate font-normal text-muted-foreground/60">{subtitle}</span>
			{/if}
		</div>
	</div>
	{#if durationLabel}
		<span class="shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground/70">
			{durationLabel}
		</span>
	{/if}
</div>
