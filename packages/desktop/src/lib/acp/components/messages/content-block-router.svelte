<script lang="ts">
import type { TokenRevealCss } from "@acepe/ui/agent-panel";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	type StreamingAnimationMode,
} from "../../types/streaming-animation-mode.js";
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
const routeState = $derived(resolveContentBlockRouteState(block));
</script>

{#if routeState.type === "render"}
	{@const Component = routeState.renderer.component}
	<Component
		{...routeState.props}
		{isStreaming}
		{tokenRevealCss}
		{projectPath}
		{streamingAnimationMode}
	/>
{:else if routeState.type === "unknown"}
	<div class="text-xs text-muted-foreground/70 italic">
		Unknown block type: {routeState.blockType}
	</div>
{:else}
	<div class="text-xs text-muted-foreground/70 italic">
		Invalid content block: {routeState.message}
	</div>
{/if}
