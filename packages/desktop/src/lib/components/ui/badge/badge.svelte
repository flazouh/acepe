<script lang="ts">
import type { HTMLAnchorAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "$lib/utils.js";

import { type BadgeVariant, badgeVariants } from "./variants.js";

let {
	ref = $bindable(null),
	href,
	class: className,
	variant = "default",
	children,
	...restProps
}: WithElementRef<HTMLAnchorAttributes> & {
	variant?: BadgeVariant;
} = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
