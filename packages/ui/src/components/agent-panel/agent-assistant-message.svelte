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
<div class="w-full mb-2 group/assistant-message">
	{#if isStreaming && !markdown}
		<div class="py-2 text-sm text-muted-foreground">
			<TextShimmer>Planning next moves…</TextShimmer>
		</div>
	{:else}
		<MarkdownDisplay content={markdown} {iconBasePath} />
	{/if}
</div>
