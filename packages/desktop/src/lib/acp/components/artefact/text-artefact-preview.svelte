<script lang="ts">
import MarkdownText from "../messages/markdown-text.svelte";

interface Props {
	content: string;
	projectPath?: string;
}

const { content, projectPath }: Props = $props();
</script>

<div class="p-3 text-sm">
	<MarkdownText text={content} {projectPath} />
</div>
