<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	label: string;
	description?: string;
	children: Snippet;
}

let { label, description, children }: Props = $props();
</script>

<div class="overflow-hidden rounded-sm border border-border bg-muted/30">
	<div class="flex items-center justify-between gap-3 px-3 py-2">
		<h3 class="min-w-0 text-[13px] font-medium text-foreground">{label}</h3>
		<div class="shrink-0">
			{@render children()}
		</div>
	</div>
	{#if description}
		<div class="border-t border-border/30 px-3 py-2">
			<p class="text-[12px] text-muted-foreground/60">{description}</p>
		</div>
	{/if}
</div>
