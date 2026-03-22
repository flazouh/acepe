<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";

import * as Sheet from "$lib/components/ui/sheet/index.js";
import { cn, type WithElementRef } from "$lib/utils.js";

import { SIDEBAR_WIDTH_MOBILE } from "./constants.js";
import { useSidebar } from "./context.svelte.js";

let {
	ref = $bindable(null),
	side = "left",
	variant = "sidebar",
	collapsible = "offcanvas",
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
	side?: "left" | "right";
	variant?: "sidebar" | "floating" | "inset";
	collapsible?: "offcanvas" | "icon" | "none";
} = $props();

const sidebar = useSidebar();
</script>

{#if collapsible === "none"}
	<div
		class={cn("text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col", className)}
		bind:this={ref}
		{...restProps}
	>
		{@render children?.()}
	</div>
{:else if sidebar.isMobile}
	<Sheet.Root bind:open={() => sidebar.openMobile, (v) => sidebar.setOpenMobile(v)} {...restProps}>
		<Sheet.Content
			data-sidebar="sidebar"
			data-slot="sidebar"
			data-mobile="true"
			class="bg-background text-sidebar-foreground w-(--sidebar-width) p-0 [&>button]:hidden"
			style="--sidebar-width: {SIDEBAR_WIDTH_MOBILE};"
			{side}
		>
			<Sheet.Header class="sr-only">
				<Sheet.Title>Sidebar</Sheet.Title>
				<Sheet.Description>Displays the mobile sidebar.</Sheet.Description>
			</Sheet.Header>
			<div class="flex h-full w-full flex-col">{@render children?.()}</div>
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<div
		bind:this={ref}
		class="text-sidebar-foreground group peer hidden md:block"
		data-state={sidebar.state}
		data-collapsible={sidebar.state === "collapsed" ? collapsible : ""}
		data-variant={variant}
		data-side={side}
		data-slot="sidebar"
	>
		<!-- This is what handles the sidebar gap on desktop -->
		<div
			data-slot="sidebar-gap"
			class={cn(
				"relative w-(--sidebar-width) bg-transparent transition-[width] duration-300 ease-out",
				"group-data-[collapsible=offcanvas]:w-0",
				"group-data-[side=right]:rotate-180",
				variant === "floating" || variant === "inset"
					? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
					: "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
			)}
		></div>
		<div
			data-slot="sidebar-container"
			class={cn(
				"fixed inset-y-0 z-10 hidden w-(--sidebar-width) transition-[left,right,width,opacity] duration-300 ease-out md:flex",
				"group-data-[collapsible=offcanvas]:opacity-0",
				side === "left"
					? "start-1 group-data-[collapsible=offcanvas]:start-[calc(var(--sidebar-width)*-1)]"
					: "end-2 group-data-[collapsible=offcanvas]:end-[calc(var(--sidebar-width)*-1)]",
				// Adjust the padding for floating and inset variants.
				// Use directional padding to keep sidebar flush against outer edge
				variant === "floating" || variant === "inset"
					? cn(
							"py-4 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]",
							side === "left" ? "" : ""
						)
					: "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
			)}
			{...restProps}
		>
			<div
				data-sidebar="sidebar"
				data-slot="sidebar-inner"
				class={cn(
					"flex h-full w-full flex-col overflow-hidden",
					variant === "floating" || variant === "inset" ? "rounded-xl" : "",
					className
				)}
			>
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}
