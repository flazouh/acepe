<script lang="ts">
import MarkdownText from "../markdown-text.svelte";

interface Props {
	text: string;
	isStreaming?: boolean;
	projectPath?: string;
}

let {
	text,
	isStreaming = false,
	projectPath,
}: Props = $props();
</script>

<MarkdownText
	{text}
	{isStreaming}
	{projectPath}
/>
