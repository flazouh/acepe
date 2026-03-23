<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	title: string;
	description?: string;
	actions?: Snippet;
}

let { title, description, actions }: Props = $props();
</script>

<div class="mb-5 flex items-start justify-between gap-4">
	<div class="min-w-0">
		<h2 class="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/60">
			{title}
		</h2>
		{#if description}
			<p class="mt-0.5 text-[12px] text-muted-foreground/50">
				{description}
			</p>
		{/if}
	</div>
	{#if actions}
		<div class="shrink-0">
			{@render actions()}
		</div>
	{/if}
</div>
