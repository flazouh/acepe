<script lang="ts">
import { buildResourceBlockDisplayState } from "./resource-block-state.js";

interface Props {
	resource: { uri: string; text?: string };
}

let { resource }: Props = $props();

const resourceState = $derived(buildResourceBlockDisplayState(resource));
</script>

<div class="space-y-1">
	<div class="text-xs text-muted-foreground">{resourceState.header}</div>
	{#if resourceState.hasText}
		<p class="text-sm text-foreground whitespace-pre-wrap break-words">
			{resourceState.text}
		</p>
	{/if}
</div>
