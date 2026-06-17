<script lang="ts">
import { buildImageBlockDisplayState } from "./media-block-state.js";

interface Props {
	data: string;
	mimeType: string;
	uri?: string;
}

let { data, mimeType, uri }: Props = $props();

const imageState = $derived(buildImageBlockDisplayState({ data, mimeType, uri }));
</script>

<div class="space-y-1">
	{#if imageState.src}
		<img src={imageState.src} alt="" class="max-w-full rounded-lg border border-border/30" />
	{:else}
		<div class="text-xs text-muted-foreground/70">{imageState.fallbackLabel}</div>
	{/if}
</div>
