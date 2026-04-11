<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		hidden?: boolean;
		items?: Snippet;
		trailing?: Snippet;
	}

	let {
		hidden = false,
		items,
		trailing,
	}: Props = $props();
</script>

<div
	class="flex items-center h-7 w-full transition-opacity duration-200 ease-out"
	class:opacity-0={hidden}
	class:pointer-events-none={hidden}
>
	{#if items}
		<div class="flex items-center h-full min-w-0">
			{@render items()}
		</div>
	{/if}

	{#if trailing}
		<div class="flex items-center h-7 ml-auto">
			{@render trailing()}
		</div>
	{/if}
</div>
