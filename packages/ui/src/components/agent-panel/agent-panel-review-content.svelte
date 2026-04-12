<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		header: Snippet;
		body: Snippet;
		footer?: Snippet;
	}

	let { children: _children, header, body, footer }: Props = $props();
</script>

<div class="flex flex-col h-full w-full overflow-hidden">
	<div class="flex min-h-8 items-center overflow-x-auto border-b border-border shrink-0">
		{@render header()}
	</div>

	<div class="flex-1 min-h-0 relative overflow-hidden">
		<div class="absolute inset-0 overflow-auto">
			{@render body()}
		</div>

		{#if footer}
			{@render footer()}
		{/if}
	</div>
</div>
