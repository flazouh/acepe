<script lang="ts">
	import type { Snippet } from "svelte";

	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { type WithoutChildrenOrChild, cn } from "../../lib/utils";
	import CheckIcon from "@lucide/svelte/icons/check";
	import MinusIcon from "@lucide/svelte/icons/minus";
	import { buildDropdownMenuInsetItemClassName } from "./dropdown-menu-item.classes.js";
	import { getDropdownMenuHighlightContext } from "./dropdown-menu-highlight-context";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		children: childrenProp,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.CheckboxItemProps> & {
		children?: Snippet;
	} = $props();

	const highlightCtx = getDropdownMenuHighlightContext();

	$effect(() => {
		if (!highlightCtx || !ref) {
			return;
		}
		return highlightCtx.attachItem(ref);
	});
</script>

<DropdownMenuPrimitive.CheckboxItem
	bind:ref
	bind:checked
	bind:indeterminate
	data-slot="dropdown-menu-checkbox-item"
	{...restProps}
	class={cn(buildDropdownMenuInsetItemClassName(Boolean(highlightCtx)), className)}
>
	{#snippet children({ checked, indeterminate })}
		<span class="pointer-events-none absolute start-2 flex size-3.5 items-center justify-center">
			{#if indeterminate}
				<MinusIcon class="size-4" />
			{:else}
				<CheckIcon class={cn("size-4", !checked && "text-transparent")} />
			{/if}
		</span>
		{@render childrenProp?.()}
	{/snippet}
</DropdownMenuPrimitive.CheckboxItem>
