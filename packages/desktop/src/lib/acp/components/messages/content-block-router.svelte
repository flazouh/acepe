<script lang="ts">
import { convertFileSrc } from "@tauri-apps/api/core";
import type { TokenRevealCss } from "@acepe/ui/agent-panel";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	type StreamingAnimationMode,
} from "../../types/streaming-animation-mode.js";
import AudioBlock from "./acp-block-types/audio-block.svelte";
import ImageBlock from "./acp-block-types/image-block.svelte";
import ResourceBlock from "./acp-block-types/resource-block.svelte";
import ResourceLinkBlock from "./acp-block-types/resource-link-block.svelte";
import TextBlock from "./acp-block-types/text-block.svelte";
import { resolveContentBlockRouteState } from "./content-block-router-state.js";

interface Props {
	block: unknown;
	/** Whether this content is currently streaming */
	isStreaming?: boolean;
	tokenRevealCss?: TokenRevealCss;
	/** Project path for opening files in panels */
	projectPath?: string;
	streamingAnimationMode?: StreamingAnimationMode;
}

let {
	block,
	isStreaming = false,
	tokenRevealCss,
	projectPath: propProjectPath,
	streamingAnimationMode = DEFAULT_STREAMING_ANIMATION_MODE,
}: Props = $props();

const projectPath = $derived(propProjectPath);
const routeState = $derived(resolveContentBlockRouteState(block, convertFileSrc));
</script>

{#if routeState.type === "render"}
	{@const renderBlock = routeState.block}
	{#if renderBlock.type === "text"}
		<TextBlock
			text={renderBlock.text}
			{isStreaming}
			{tokenRevealCss}
			{projectPath}
			{streamingAnimationMode}
		/>
	{:else if renderBlock.type === "image"}
		<ImageBlock
			data={renderBlock.data}
			mimeType={renderBlock.mimeType}
			uri={renderBlock.uri}
		/>
	{:else if renderBlock.type === "audio"}
		<AudioBlock data={renderBlock.data} mimeType={renderBlock.mimeType} />
	{:else if renderBlock.type === "resource"}
		<ResourceBlock resource={renderBlock.resource} />
	{:else}
		<ResourceLinkBlock
			uri={renderBlock.uri}
			name={renderBlock.name}
			title={renderBlock.title}
			description={renderBlock.description}
		/>
	{/if}
{:else}
	<div class="text-xs text-muted-foreground/70 italic">
		Invalid content block: {routeState.message}
	</div>
{/if}
