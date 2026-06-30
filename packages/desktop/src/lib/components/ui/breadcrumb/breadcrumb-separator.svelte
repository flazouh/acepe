<script lang="ts">
import { CaretRight } from "phosphor-svelte";
import type { HTMLLiAttributes } from "svelte/elements";
import { cn, type WithElementRef } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLLiAttributes> = $props();
</script>

<li
	bind:this={ref}
	data-slot="breadcrumb-separator"
	role="presentation"
	aria-hidden="true"
	class={cn("[&>svg]:size-3", className)}
	{...restProps}
>
	{#if children}
		{@render children?.()}
	{:else}
		<CaretRight size={12} weight="regular"  class="size-3"/>
	{/if}
</li>
