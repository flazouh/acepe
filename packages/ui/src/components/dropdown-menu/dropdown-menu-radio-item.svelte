<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { type WithoutChild, cn } from "../../lib/utils";
	import CircleIcon from "@lucide/svelte/icons/circle";
	import { getDropdownMenuHighlightContext } from "./dropdown-menu-highlight-context";

	let {
		ref = $bindable(null),
		class: className,
		children: childrenProp,
		onpointerenter: restOnPointerEnter,
		onpointerleave: restOnPointerLeave,
		...restProps
	}: WithoutChild<DropdownMenuPrimitive.RadioItemProps> = $props();

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

<DropdownMenuPrimitive.RadioItem
	bind:ref
	data-slot="dropdown-menu-radio-item"
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
	{...restProps}
	class={cn(
		// When inside Content with sliding highlight: bg from layer. Else: item bg.
		highlightCtx
			? "bg-transparent text-popover-foreground hover:text-accent-foreground focus:text-accent-foreground data-[highlighted]:text-accent-foreground"
			: "hover:bg-muted hover:text-accent-foreground focus:bg-muted focus:text-accent-foreground data-[highlighted]:bg-muted data-[highlighted]:text-accent-foreground",
		"transition-colors duration-75 ease-out",
		"relative z-10",
		"data-[selected]:bg-accent data-[selected]:text-accent-foreground",
		"aria-selected:bg-accent aria-selected:text-accent-foreground",
		// Layout & typography (embedded design)
		"relative flex cursor-default items-center gap-2",
		"py-1 ps-8 pe-2 text-[11px] font-medium",
		"outline-hidden select-none",
		// Embedded borders between items
		"border-b border-border/20 last:border-b-0",
		// States & svg
		"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className
	)}
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
