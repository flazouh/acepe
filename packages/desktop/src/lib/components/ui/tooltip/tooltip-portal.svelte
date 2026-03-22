<script lang="ts">
import { Tooltip as TooltipPrimitive } from "bits-ui";

let { children, ...restProps }: TooltipPrimitive.PortalProps = $props();
</script>

<TooltipPrimitive.Portal {...restProps}>
	{@render children?.()}
</TooltipPrimitive.Portal>
