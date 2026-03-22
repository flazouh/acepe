<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	label: string;
	description?: string;
	children: Snippet;
}

let { label, description, children }: Props = $props();
</script>

<div class="flex items-center justify-between border-b border-border/30 px-5 py-4 last:border-b-0">
	<div class="flex-1 min-w-0 pr-5">
		<div class="text-[13px] font-medium">{label}</div>
		{#if description}
			<div class="mt-1.5 text-[12px] text-muted-foreground/60">{description}</div>
		{/if}
	</div>
	<div class="shrink-0">
		{@render children()}
	</div>
</div>
