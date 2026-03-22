<script lang="ts">
import { Tooltip as TooltipPrimitive } from "bits-ui";
import type { ComponentProps } from "svelte";
import type { WithoutChildrenOrChild } from "$lib/utils.js";

import { cn } from "$lib/utils.js";

import TooltipPortal from "./tooltip-portal.svelte";

let {
	ref = $bindable(null),
	class: className,
	sideOffset = 0,
	side = "top",
	children,
	portalProps,
	...restProps
}: TooltipPrimitive.ContentProps & {
	portalProps?: WithoutChildrenOrChild<ComponentProps<typeof TooltipPortal>>;
} = $props();
</script>

<TooltipPortal {...portalProps}>
	<TooltipPrimitive.Content
		bind:ref
		data-slot="tooltip-content"
		{sideOffset}
		{side}
		class={cn(
			"bg-popover border border-border text-foreground z-[var(--overlay-z)] w-fit rounded-md px-3 py-1.5 text-xs text-balance shadow-md",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</TooltipPrimitive.Content>
</TooltipPortal>
