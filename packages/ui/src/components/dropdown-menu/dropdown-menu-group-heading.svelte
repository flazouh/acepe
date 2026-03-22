<script lang="ts">
	import type { ComponentProps } from "svelte";

	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { cn } from "../../lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		...restProps
	}: ComponentProps<typeof DropdownMenuPrimitive.GroupHeading> & {
		inset?: boolean;
	} = $props();
</script>

<DropdownMenuPrimitive.GroupHeading
	bind:ref
	data-slot="dropdown-menu-group-heading"
	data-inset={inset}
	class={cn("px-2 py-1 text-[11px] font-semibold text-muted-foreground border-b border-border/20 last:border-b-0 data-[inset]:ps-8", className)}
	{...restProps}
/>
