<script lang="ts">
import type { HTMLTableAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "../../lib/utils.js";

import "./table.css";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLTableAttributes> = $props();
</script>

<div data-slot="table-container" class={cn("acepe-table-wrapper", className)}>
	<table bind:this={ref} data-slot="table" {...restProps}>
		{@render children?.()}
	</table>
</div>
