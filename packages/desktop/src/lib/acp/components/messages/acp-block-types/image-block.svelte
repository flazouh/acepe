<script lang="ts">
interface Props {
	data: string;
	mimeType: string;
	uri?: string;
}

let { data, mimeType, uri }: Props = $props();

const imageSrc = $derived(uri || (data ? `data:${mimeType};base64,${data}` : null));
</script>

<div class="space-y-1">
	{#if imageSrc}
		<img src={imageSrc} alt="" class="max-w-full rounded border border-border/30" />
	{:else}
		<div class="text-xs text-muted-foreground/70">Image ({mimeType})</div>
	{/if}
</div>
