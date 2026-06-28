<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { type WithoutChild, cn } from "../../lib/utils";
	import CircleIcon from "@lucide/svelte/icons/circle";
	import { buildDropdownMenuInsetItemClassName } from "./dropdown-menu-item.classes.js";
	import { getDropdownMenuHighlightContext } from "./dropdown-menu-highlight-context";

	let {
		ref = $bindable(null),
		class: className,
		children: childrenProp,
		...restProps
	}: WithoutChild<DropdownMenuPrimitive.RadioItemProps> = $props();

	const highlightCtx = getDropdownMenuHighlightContext();

	$effect(() => {
		if (!highlightCtx || !ref) {
			return;
		}
		return highlightCtx.attachItem(ref);
	});
</script>

<DropdownMenuPrimitive.RadioItem
	bind:ref
	data-slot="dropdown-menu-radio-item"
	{...restProps}
	class={cn(buildDropdownMenuInsetItemClassName(Boolean(highlightCtx)), className)}
>
	{#snippet children({ checked })}
		<span class="pointer-events-none absolute start-2 flex size-3.5 items-center justify-center">
			{#if checked}
				<CircleIcon class="size-2 fill-current" />
			{/if}
		</span>
		{@render childrenProp?.({ checked })}
	{/snippet}
</DropdownMenuPrimitive.RadioItem>
