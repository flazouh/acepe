<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import { cn } from "../../lib/utils.js";
	import TooltipPortal from "./tooltip-portal.svelte";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		side = "top",
		children,
		...restProps
	}: TooltipPrimitive.ContentProps = $props();
</script>

<TooltipPortal>
	<TooltipPrimitive.Content
		bind:ref
		data-slot="tooltip-content"
		{sideOffset}
		{side}
		class={cn(
			"bg-popover border border-border text-foreground z-50 w-fit max-w-48 rounded-md px-2 py-1.5 text-xs shadow-md",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</TooltipPrimitive.Content>
</TooltipPortal>
