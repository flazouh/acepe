<script lang="ts">
	import { CaretRight } from "phosphor-svelte";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { cn } from "../../lib/utils";
	import { RoundedIcon } from "../icons/index.js";
	import { dropdownMenuItemRadiusClass } from "./dropdown-menu-item.classes.js";
	import { dropdownMenuItemTypographyClass } from "./dropdown-menu-typography.js";
	import { getDropdownMenuHighlightContext } from "./dropdown-menu-highlight-context";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		onpointerenter: restOnPointerEnter,
		onpointerleave: restOnPointerLeave,
		...restProps
	}: DropdownMenuPrimitive.SubTriggerProps & {
		inset?: boolean;
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

<DropdownMenuPrimitive.SubTrigger
	bind:ref
	data-slot="dropdown-menu-sub-trigger"
	data-inset={inset}
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
	{...restProps}
	class={cn(
		// When inside Content with sliding highlight: bg from layer. Else: item bg.
		// Explicit text-popover-foreground so label stays visible on hover (avoids disappearing label bug).
		highlightCtx
			? "bg-transparent text-popover-foreground hover:text-accent-foreground focus:text-accent-foreground data-[highlighted]:text-accent-foreground"
			: "hover:bg-muted hover:text-accent-foreground focus:bg-muted focus:text-accent-foreground data-[highlighted]:bg-muted data-[highlighted]:text-accent-foreground",
		"transition-colors duration-75 ease-out",
		"data-[state=open]:bg-muted data-[state=open]:text-accent-foreground",
		// Layout & typography (embedded design); relative z-10 so content stacks above sliding highlight
		`relative z-10 flex cursor-default items-center gap-2 ${dropdownMenuItemRadiusClass}`,
		`px-2 py-1 ${dropdownMenuItemTypographyClass}`,
		"outline-hidden select-none",
		// States & svg
		"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
		"data-[inset]:ps-8",
		"[&_svg:not([class*='text-'])]:text-muted-foreground",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
		className
	)}
>
	{@render children?.()}
	<CaretRight size={12} weight="regular" class="size-3 shrink-0 ms-auto text-muted-foreground" />
</DropdownMenuPrimitive.SubTrigger>
