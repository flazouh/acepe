<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
import * as m from "$lib/messages.js";
import type { WithElementRef } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<nav
	bind:this={ref}
	data-slot="breadcrumb"
	class={className}
	aria-label={m.aria_breadcrumb()}
	{...restProps}
>
	{@render children?.()}
</nav>
