<script lang="ts">
import { buildResourceLinkBlockDisplayState } from "./resource-block-state.js";

interface Props {
	uri: string;
	name: string;
	title?: string;
	description?: string;
}

let { uri, name, title, description }: Props = $props();

const linkState = $derived(buildResourceLinkBlockDisplayState({ uri, name, title, description }));

function openResourceLink(): void {
	window.open(linkState.uri, linkState.openTarget, linkState.openFeatures);
}
</script>

<div class="space-y-1">
	<div class="text-xs font-medium text-foreground">{linkState.name}</div>
	{#if linkState.hasTitle}
		<div class="text-xs text-muted-foreground">{linkState.title}</div>
	{/if}
	{#if linkState.hasDescription}
		<div class="text-xs text-muted-foreground/80">{linkState.description}</div>
	{/if}
	<button
		type="button"
		onclick={openResourceLink}
		class="text-xs text-primary hover:underline break-all text-left"
	>
		{linkState.uri}
	</button>
</div>
