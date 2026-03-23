<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
import * as m from "$lib/paraglide/messages.js";
import { cn, type WithElementRef } from "$lib/utils.js";
import * as Tooltip from "../tooltip/index.js";
import { useSidebar } from "./context.svelte.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLButtonElement>, HTMLButtonElement> = $props();

const sidebar = useSidebar();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		<button
			bind:this={ref}
			data-sidebar="rail"
			data-slot="sidebar-rail"
			aria-label={m.aria_toggle_sidebar()}
			tabIndex={-1}
			onclick={sidebar.toggle}
			class={cn(
				"hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all duration-300 ease-out group-data-[side=left]:-end-4 group-data-[side=right]:start-0 after:absolute after:inset-y-0 after:start-[calc(1/2*100%-1px)] after:w-[2px] sm:flex",
				"in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
				"[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
				"hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:start-full",
				"[[data-side=left][data-collapsible=offcanvas]_&]:-end-2",
				"[[data-side=right][data-collapsible=offcanvas]_&]:-start-2",
				className
			)}
			{...restProps}
		>
			{@render children?.()}
		</button>
	</Tooltip.Trigger>
	<Tooltip.Content>
		{m.aria_toggle_sidebar()}
	</Tooltip.Content>
</Tooltip.Root>
