<script lang="ts">
import type { Snippet } from "svelte";

let {
	class: className = "",
	content,
	footer,
}: {
	class?: string;
	content: Snippet;
	footer?: Snippet;
} = $props();
</script>

<div
	class="relative h-fit flex flex-col select-none overflow-hidden rounded-xl bg-input/30 {className}"
>
	<div class="p-2">
		{@render content()}
	</div>
	{#if footer}
		<div class="flex items-center justify-between gap-2 h-7 border-t border-border/50">
			{@render footer()}
		</div>
	{/if}
</div>
