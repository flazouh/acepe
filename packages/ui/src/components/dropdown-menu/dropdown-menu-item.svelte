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
		onpointerenter: restOnPointerEnter,
		onpointerleave: restOnPointerLeave,
		...restProps
	}: DropdownMenuPrimitive.ItemProps & {
		inset?: boolean;
		variant?: "default" | "destructive";
	} = $props();

	const highlightCtx = getDropdownMenuHighlightContext();

	function handlePointerEnter(e: PointerEvent): void {
		highlightCtx?.updateHighlight(e.currentTarget as HTMLElement);
		restOnPointerEnter?.(e as Parameters<NonNullable<typeof restOnPointerEnter>>[0]);
	}

	function handlePointerLeave(e: PointerEvent): void {
		highlightCtx?.clearHighlight();
		restOnPointerLeave?.(e as Parameters<NonNullable<typeof restOnPointerLeave>>[0]);
	}
</script>

<DropdownMenuPrimitive.Item
	bind:ref
	data-slot="dropdown-menu-item"
	data-inset={inset}
	data-variant={variant}
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
	{...restProps}
	class={cn(
		buildDropdownMenuItemClassName(Boolean(highlightCtx)),
		className
	)}
/>
