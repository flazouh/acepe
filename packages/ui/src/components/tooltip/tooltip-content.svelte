<script lang="ts">
	import type { ComponentProps, Snippet } from "svelte";

	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import { type WithoutChildrenOrChild, cn } from "../../lib/utils.js";
	import { buildCardSurfaceShellClassName } from "../../lib/card-surface-shell.classes.js";
	import TooltipPortal from "./tooltip-portal.svelte";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		side = "top",
		children,
		portalProps,
		...restProps
	}: TooltipPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof TooltipPortal>>;
		children?: Snippet;
	} = $props();
</script>

<TooltipPortal {...portalProps}>
	<TooltipPrimitive.Content
		bind:ref
		data-slot="tooltip-content"
		{sideOffset}
		{side}
		class={cn(
			buildCardSurfaceShellClassName(
				"z-[var(--overlay-z)] w-fit max-w-48 border border-border px-2 py-1.5 text-xs font-medium outline-hidden"
			),
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</TooltipPrimitive.Content>
</TooltipPortal>
