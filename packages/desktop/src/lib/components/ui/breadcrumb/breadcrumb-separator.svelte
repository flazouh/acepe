<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui";
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
		<HugeiconsIcon name="chevron-right" class="size-3" />
	{/if}
</li>
