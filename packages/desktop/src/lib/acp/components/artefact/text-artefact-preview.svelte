<script lang="ts">
import { useSessionContext } from "../../hooks/use-session-context.js";
import MarkdownText from "../messages/markdown-text.svelte";

interface Props {
	content: string;
}

const { content }: Props = $props();

// Get projectPath from session context
const sessionContext = useSessionContext();
const projectPath = $derived(sessionContext?.projectPath);
</script>

<div class="p-3 text-sm">
	<MarkdownText text={content} {projectPath} />
</div>
