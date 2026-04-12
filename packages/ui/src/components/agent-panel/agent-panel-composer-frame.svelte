<script lang="ts">
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";

	interface Props {
		centered?: boolean;
		widthClass?: string;
		class?: string;
		innerClass?: string;
		children?: Snippet;
	}

	let {
		centered = false,
		widthClass = "max-w-[60%]",
		class: className = "",
		innerClass = "",
		children,
	}: Props = $props();
</script>

<div
	class={cn("shrink-0 px-2 pb-2", centered && "flex justify-center", className)}
	data-input-area
>
	<div class={cn(centered && "w-full", centered && widthClass, innerClass)}>
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>
