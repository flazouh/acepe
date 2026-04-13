<script lang="ts">
import MarkdownText from "../markdown-text.svelte";

interface Props {
	text: string;
	isStreaming?: boolean;
	revealKey?: string;
	projectPath?: string;
}

let { text, isStreaming = false, revealKey, projectPath }: Props = $props();
</script>

<MarkdownText {text} {isStreaming} {revealKey} {projectPath} />
