<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import IconSparkles from "@tabler/icons-svelte/icons/sparkles";

import type { TaskContent } from "../../../schemas/tool-call-content.schema.js";

interface Props {
	content: TaskContent;
	isStreaming?: boolean;
}

let { content, isStreaming = false }: Props = $props();

// Truncate description for display
const displayDescription = $derived(
	content.description && content.description.length > 100
		? `${content.description.slice(0, 100)}...`
		: content.description
);
</script>

<div class="rounded-md border bg-card overflow-hidden">
	<div class="flex items-center gap-2 px-3 py-2">
		<IconSparkles class="size-3.5 text-primary" />

		<!-- Task description -->
		{#if isStreaming}
			<TextShimmer class="text-xs font-medium text-foreground truncate">
				{displayDescription ?? "Running task..."}
			</TextShimmer>
		{:else}
			<span class="text-xs font-medium text-foreground truncate">
				{displayDescription ?? "Running task..."}
			</span>
		{/if}

		<!-- Subagent type badge -->
		{#if content.subagentType}
			<span class="ml-auto text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
				{content.subagentType}
			</span>
		{/if}
	</div>

	<!-- Prompt preview if available -->
	{#if content.prompt}
		<div class="px-3 py-2 border-t bg-muted/20">
			<div class="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
				{content.prompt.length > 200 ? content.prompt.slice(0, 200) + "..." : content.prompt}
			</div>
		</div>
	{/if}
</div>
