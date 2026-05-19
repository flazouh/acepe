<script lang="ts">
import type { TokenRevealCss } from "@acepe/ui/agent-panel";
import type { ContentBlock } from "../../schemas/content-block.schema.js";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	type StreamingAnimationMode,
} from "../../types/streaming-animation-mode.js";
import { validateContentBlock } from "../../utils/content-block-validator.js";
import { getBlockRenderer } from "./acp-block-types/registry.js";

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
const validationResult = $derived(validateContentBlock(block));
</script>

{#if validationResult.isOk()}
	{@const validatedBlock = validationResult.value}
	{@const renderer = getBlockRenderer(validatedBlock.type)}
	{#if renderer}
		{@const Component = renderer.component}
		{@const blockProps = (
			renderer as { getProps: (b: ContentBlock) => Record<string, unknown> }
		).getProps(validatedBlock)}
		<Component
			{...blockProps}
			{isStreaming}
			{tokenRevealCss}
			{projectPath}
			{streamingAnimationMode}
		/>
	{:else}
		<div class="text-xs text-muted-foreground/70 italic">
			Unknown block type: {validatedBlock.type}
		</div>
	{/if}
{:else}
	<div class="text-xs text-muted-foreground/70 italic">
		Invalid content block: {validationResult.error.message}
	</div>
{/if}
