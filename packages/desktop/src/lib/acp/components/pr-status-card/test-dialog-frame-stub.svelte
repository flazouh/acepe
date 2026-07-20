<script lang="ts">
import type { Snippet } from "svelte";

let {
	open,
	children,
	footer,
}: {
	open: boolean;
	children?: Snippet;
	footer?: Snippet;
} = $props();
</script>

{#if open}
	<div data-testid="dialog-frame-stub">
		{#if children}
			{@render children()}
		{/if}
		{#if footer}
			{@render footer()}
		{/if}
	</div>
{/if}
