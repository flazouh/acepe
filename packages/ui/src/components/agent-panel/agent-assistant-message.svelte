<script lang="ts">
	import { MarkdownDisplay } from "../markdown/index.js";
	import { TextShimmer } from "../text-shimmer/index.js";

	interface Props {
		markdown: string;
		isStreaming?: boolean;
		/** Base path for file type SVG icons (e.g. "/svgs/icons") */
		iconBasePath?: string;
	}

	let { markdown, isStreaming = false, iconBasePath = "" }: Props = $props();
</script>

<!-- Mirrors desktop AssistantMessage: full width, no card wrapping -->
<div class="group/assistant-message mb-2 w-full min-w-0 max-w-full overflow-x-hidden">
	{#if isStreaming && !markdown}
		<div class="py-2 text-sm text-muted-foreground">
			<TextShimmer>Planning next moves…</TextShimmer>
		</div>
	{:else}
		<MarkdownDisplay
			content={markdown}
			textSize="text-sm"
			class="agent-assistant-markdown"
			{iconBasePath}
		/>
	{/if}
</div>

<style>
	:global(.agent-assistant-markdown .markdown-content),
	:global(.agent-assistant-markdown .markdown-loading) {
		line-height: 1.5;
	}
</style>
