<script lang="ts">
	import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { cn } from "../../lib/utils";
	import { buildDropdownMenuItemClassName } from "./dropdown-menu-item.classes.js";
	import { getDropdownMenuHighlightContext } from "./dropdown-menu-highlight-context";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: DropdownMenuPrimitive.SubTriggerProps & {
		inset?: boolean;
	} = $props();

	const highlightCtx = getDropdownMenuHighlightContext();

	$effect(() => {
		if (!highlightCtx || !ref) {
			return;
		}
		return highlightCtx.attachItem(ref);
	});
</script>

<DropdownMenuPrimitive.SubTrigger
	bind:ref
	data-slot="dropdown-menu-sub-trigger"
	data-inset={inset}
	{...restProps}
	class={cn(buildDropdownMenuItemClassName(Boolean(highlightCtx)), className)}
>
	{@render children?.()}
	<ChevronRightIcon class="ms-auto size-4" />
</DropdownMenuPrimitive.SubTrigger>
