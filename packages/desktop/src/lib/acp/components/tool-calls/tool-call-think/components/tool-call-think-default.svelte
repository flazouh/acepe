<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import type { ToolCall } from "../../../../types/tool-call.js";
import type { ToolCallThinkState } from "../state/tool-call-think-state.svelte.js";

interface Props {
	toolCall: ToolCall;
	state: ToolCallThinkState;
}

let { toolCall, state }: Props = $props();
</script>

<div class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
	{#if state.isLive}
		<TextShimmer class="font-medium">{toolCall.title}</TextShimmer>
	{:else}
		<span class="font-medium">{toolCall.title}</span>
	{/if}
	{#if state.description}
		<span class="text-muted-foreground/80 truncate max-w-md">{state.description}</span>
	{/if}
</div>
