<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";

	let { open = $bindable(false), children, ...restProps }: TooltipPrimitive.RootProps = $props();
</script>

<TooltipPrimitive.Provider delayDuration={0}>
	<TooltipPrimitive.Root bind:open {...restProps}>
		{@render children?.()}
	</TooltipPrimitive.Root>
</TooltipPrimitive.Provider>
