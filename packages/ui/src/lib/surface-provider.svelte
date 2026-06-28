<script lang="ts">
	import type { Snippet } from "svelte";

	import { setSurfaceContext } from "./surface-context.js";

	let {
		level,
		children,
	}: {
		level: number;
		children?: Snippet;
	} = $props();

	setSurfaceContext(level);
</script>

{#if children}
	{@render children()}
{/if}
