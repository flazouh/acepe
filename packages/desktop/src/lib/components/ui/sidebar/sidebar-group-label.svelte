<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "$lib/utils.js";

let {
	ref = $bindable(null),
	children,
	child,
	class: className,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLElement>> & {
	child?: Snippet<[{ props: Record<string, unknown> }]>;
} = $props();

const mergedProps = $derived({
	class: cn(
		"flex h-8 shrink-0 items-center rounded-md px-2 font-medium text-sidebar-foreground/70 text-xs outline-hidden ring-sidebar-ring focus-visible:ring-2 [&>svg:not([class*='size-'])]:size-3 [&>svg]:shrink-0",
		"group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
		className
	),
	"data-slot": "sidebar-group-label",
	"data-sidebar": "group-label",
	...restProps,
});
</script>

{#if child}{@render child({ props: mergedProps })}
{:else}
	<div bind:this={ref} {...mergedProps}>{@render children?.()}</div>
{/if}
