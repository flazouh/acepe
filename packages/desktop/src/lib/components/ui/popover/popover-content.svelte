<script lang="ts">
import { Popover as PopoverPrimitive } from "bits-ui";
import type { ComponentProps, Snippet } from "svelte";

import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

import PopoverPortal from "./popover-portal.svelte";

let {
	ref = $bindable(null),
	class: className,
	sideOffset = 4,
	align = "center",
	portalProps,
	children,
	...restProps
}: PopoverPrimitive.ContentProps & {
	portalProps?: WithoutChildrenOrChild<ComponentProps<typeof PopoverPortal>>;
	children?: Snippet;
} = $props();
</script>

<PopoverPortal {...portalProps}>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		{sideOffset}
		{align}
		class={cn(
			"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-end-2 data-[side=right]:slide-in-from-start-2 data-[side=top]:slide-in-from-bottom-2 z-[var(--overlay-z)] w-72 origin-(--bits-popover-content-transform-origin) rounded-lg border p-4 shadow-md outline-hidden",
			className
		)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{/if}
	</PopoverPrimitive.Content>
</PopoverPortal>
