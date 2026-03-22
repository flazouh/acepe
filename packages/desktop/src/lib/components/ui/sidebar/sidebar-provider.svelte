<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";

import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { cn, type WithElementRef } from "$lib/utils.js";

import {
	SIDEBAR_COOKIE_MAX_AGE,
	SIDEBAR_COOKIE_NAME,
	SIDEBAR_WIDTH,
	SIDEBAR_WIDTH_ICON,
} from "./constants.js";
import { setSidebar } from "./context.svelte.js";

let {
	ref = $bindable(null),
	open = $bindable(true),
	onOpenChange = () => {},
	class: className,
	style,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
} = $props();

const sidebar = setSidebar({
	open: () => open,
	setOpen: (value: boolean) => {
		open = value;
		onOpenChange(value);

		// This sets the cookie to keep the sidebar state.
		// biome-ignore lint/suspicious/noDocumentCookie: sidebar state persisted via cookie for SSR compatibility
		document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
	},
});
</script>

<svelte:window onkeydown={sidebar.handleShortcutKeydown} />

<Tooltip.Provider delayDuration={0} disableHoverableContent>
	<div
		data-slot="sidebar-wrapper"
		style="--sidebar-width: {SIDEBAR_WIDTH}; --sidebar-width-icon: {SIDEBAR_WIDTH_ICON}; {style}"
		class={cn(
			"group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex h-screen w-full",
			// Add padding-left when sidebar is collapsed on medium screens and above
			// This works for both inset and floating variants when collapsed
			sidebar.state === "collapsed" && !sidebar.isMobile ? "md:pl-2" : "",
			className
		)}
		bind:this={ref}
		{...restProps}
	>
		{@render children?.()}
	</div>
</Tooltip.Provider>
