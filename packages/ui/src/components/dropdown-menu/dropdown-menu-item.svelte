<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { cn } from "../../lib/utils";
import { buildDropdownMenuItemClassName } from "./dropdown-menu-item.classes";
import { getDropdownMenuHighlightContext } from "./dropdown-menu-highlight-context";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		variant = "default",
		...restProps
	}: DropdownMenuPrimitive.ItemProps & {
		inset?: boolean;
		variant?: "default" | "destructive";
	} = $props();

	const highlightCtx = getDropdownMenuHighlightContext();

	$effect(() => {
		if (!highlightCtx || !ref) {
			return;
		}
		return highlightCtx.attachItem(ref);
	});
</script>

<DropdownMenuPrimitive.Item
	bind:ref
	data-slot="dropdown-menu-item"
	data-inset={inset}
	data-variant={variant}
	{...restProps}
	class={cn(
		buildDropdownMenuItemClassName(Boolean(highlightCtx)),
		className
	)}
/>
