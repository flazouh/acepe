<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { cn } from "../../lib/utils";
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
		// When inside Content with sliding highlight: bg from layer. Else: item bg.
		// Explicit text-popover-foreground so label stays visible on hover.
		highlightCtx
			? "bg-transparent text-popover-foreground hover:text-accent-foreground focus:text-accent-foreground data-[highlighted]:text-accent-foreground"
			: "hover:bg-muted hover:text-accent-foreground focus:bg-muted focus:text-accent-foreground data-[highlighted]:bg-muted data-[highlighted]:text-accent-foreground",
		"transition-colors duration-75 ease-out",
		"relative z-10",
		"data-[selected]:bg-accent data-[selected]:text-accent-foreground",
		"aria-selected:bg-accent aria-selected:text-accent-foreground",
		// Destructive variant (overlay on sliding highlight)
		"data-[variant=destructive]:text-destructive",
		"data-[variant=destructive]:data-highlighted:bg-destructive/10",
		"dark:data-[variant=destructive]:data-highlighted:bg-destructive/20",
		"data-[variant=destructive]:data-highlighted:text-destructive",
		"data-[variant=destructive]:*:[svg]:!text-destructive",
		// Layout & typography (embedded design)
		"relative flex cursor-default items-center gap-2",
		"px-2 py-1 text-[11px] font-medium",
		"outline-hidden select-none",
		// Embedded borders between items
		"border-b border-border/20 last:border-b-0",
		// States & svg
		"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
		"data-[inset]:ps-8",
		"[&_svg:not([class*='text-'])]:text-muted-foreground",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className
	)}
/>
