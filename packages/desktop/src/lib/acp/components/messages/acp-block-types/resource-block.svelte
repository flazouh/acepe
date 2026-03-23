<script lang="ts">
interface Props {
	resource: { uri: string; text?: string };
}

let { resource }: Props = $props();
</script>

<div class="space-y-1">
	<div class="text-xs text-muted-foreground">Resource: {resource.uri}</div>
	{#if resource.text}
		<p class="text-sm text-foreground whitespace-pre-wrap break-words">
			{resource.text}
		</p>
	{/if}
</div>
