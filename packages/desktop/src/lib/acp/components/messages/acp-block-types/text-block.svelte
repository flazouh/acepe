<script lang="ts">
import TypewriterText from "../typewriter-text.svelte";

interface Props {
	text: string;
	isStreaming?: boolean;
	projectPath?: string;
}

let { text, isStreaming = false, projectPath }: Props = $props();
</script>

<TypewriterText {text} {isStreaming} {projectPath} />
