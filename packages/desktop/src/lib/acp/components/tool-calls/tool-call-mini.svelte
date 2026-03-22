<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import { getToolKindSubtitle, getToolKindTitle } from "../../registry/tool-kind-ui-registry.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
}

let { toolCall, turnState }: Props = $props();

const resolvedKind = $derived<ToolKind>(toolCall.kind ?? "other");
const toolStatus = $derived(getToolStatus(toolCall, turnState));
const title = $derived(getToolKindTitle(resolvedKind, toolCall, turnState));
const subtitle = $derived(getToolKindSubtitle(resolvedKind, toolCall));
</script>

<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
	{#if toolStatus.isPending}
		<TextShimmer class="inline-flex items-center gap-1.5">
			<span class="font-medium">{title}</span>
			{#if subtitle}
				<span class="text-muted-foreground/60">{subtitle}</span>
			{/if}
		</TextShimmer>
	{:else}
		<span class="font-medium">{title}</span>
		{#if subtitle}
			<span class="text-muted-foreground/60">{subtitle}</span>
		{/if}
	{/if}
</div>
