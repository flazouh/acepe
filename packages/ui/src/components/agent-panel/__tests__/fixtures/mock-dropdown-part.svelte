<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		child?: Snippet<[{ props: Record<string, string> }]>;
		onSelect?: () => void;
	}

	let { children, child, onSelect }: Props = $props();
</script>

{#if child}
	{@render child({ props: {} })}
{/if}

{#if children}
	<button type="button" onclick={() => onSelect?.()}>
		{@render children()}
	</button>
{/if}
