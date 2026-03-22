<script lang="ts">
import { Tooltip as TooltipPrimitive } from "bits-ui";

let { children, ...restProps }: TooltipPrimitive.ProviderProps = $props();
</script>

<TooltipPrimitive.Provider {...restProps}>
	{@render children?.()}
</TooltipPrimitive.Provider>
