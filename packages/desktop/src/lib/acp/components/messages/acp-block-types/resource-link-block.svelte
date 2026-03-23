<script lang="ts">
interface Props {
	uri: string;
	name: string;
	title?: string;
	description?: string;
}

let { uri, name, title, description }: Props = $props();
</script>

<div class="space-y-1">
	<div class="text-xs font-medium text-foreground">{name}</div>
	{#if title}
		<div class="text-xs text-muted-foreground">{title}</div>
	{/if}
	{#if description}
		<div class="text-xs text-muted-foreground/80">{description}</div>
	{/if}
	<button
		type="button"
		onclick={() => window.open(uri, "_blank", "noopener,noreferrer")}
		class="text-xs text-primary hover:underline break-all text-left"
	>
		{uri}
	</button>
</div>
