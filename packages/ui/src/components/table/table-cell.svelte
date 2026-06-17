<script lang="ts">
import type { HTMLTdAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "../../lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLTdAttributes> = $props();
</script>

<td
	bind:this={ref}
	data-slot="table-cell"
	class={cn("[&:has([role=checkbox])]:pe-0", className)}
	{...restProps}
>
	{@render children?.()}
</td>
