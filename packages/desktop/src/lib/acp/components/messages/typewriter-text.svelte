<script lang="ts">
import { useSessionContext } from "$lib/acp/hooks/use-session-context.js";
import { onMount } from "svelte";

import { createTypewriterRevealBinding } from "./logic/typewriter-reveal-controller.js";
import MarkdownText from "./markdown-text.svelte";

interface Props {
	text: string;
	isStreaming: boolean;
	projectPath?: string;
}

let { text, isStreaming, projectPath: propProjectPath }: Props = $props();

// Get projectPath from session context, with prop fallback
const sessionContext = useSessionContext();
const projectPath = $derived(propProjectPath ?? sessionContext?.projectPath);

let containerRef: HTMLDivElement | null = $state(null);
const revealBinding = createTypewriterRevealBinding();

$effect(() => {
	revealBinding.bindContainer(containerRef);
});

$effect(() => {
	revealBinding.setStreaming(isStreaming);
});

onMount(() => {
	return () => {
		revealBinding.destroy();
	};
});
</script>

	<div bind:this={containerRef}>
		<MarkdownText {text} {isStreaming} {projectPath} />
	</div>
