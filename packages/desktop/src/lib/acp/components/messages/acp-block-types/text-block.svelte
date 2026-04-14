<script lang="ts">
import MarkdownText from "../markdown-text.svelte";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	type StreamingAnimationMode,
} from "../../../types/streaming-animation-mode.js";

interface Props {
	text: string;
	isStreaming?: boolean;
	revealKey?: string;
	projectPath?: string;
	streamingAnimationMode?: StreamingAnimationMode;
}

let {
	text,
	isStreaming = false,
	revealKey,
	projectPath,
	streamingAnimationMode = DEFAULT_STREAMING_ANIMATION_MODE,
}: Props = $props();
</script>

<MarkdownText {text} {isStreaming} {revealKey} {projectPath} {streamingAnimationMode} />
