<script lang="ts">
interface Props {
	toolName: string;
	subtitle?: string;
}

let { toolName, subtitle }: Props = $props();
</script>

<div class="flex items-center gap-1.5 rounded-md px-1 py-0.5">
	<span class="text-xs text-muted-foreground">
		{toolName} interrupted
	</span>
	{#if subtitle}
		<span class="truncate text-xs text-muted-foreground/60">
			{subtitle}
		</span>
	{/if}
</div>
