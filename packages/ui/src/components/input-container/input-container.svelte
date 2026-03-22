<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "../../lib/utils.js";

	let {
		class: className = "",
		children,
	}: {
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div class={cn("relative h-fit px-3 py-2 flex flex-col gap-2 rounded-xl bg-input/30", className)}>
	{@render children()}
</div>
