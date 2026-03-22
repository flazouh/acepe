<script lang="ts">
import { Tooltip as TooltipPrimitive } from "bits-ui";

let {
	ref = $bindable(null),
	children,
	child,
	...restProps
}: TooltipPrimitive.TriggerProps = $props();
</script>

<TooltipPrimitive.Trigger bind:ref data-slot="tooltip-trigger" {child} {...restProps}>
	{@render children?.()}
</TooltipPrimitive.Trigger>
