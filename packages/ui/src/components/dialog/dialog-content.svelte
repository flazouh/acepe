<script lang="ts">
import XIcon from "@lucide/svelte/icons/x";
import { Dialog as DialogPrimitive } from "bits-ui";
import type { ComponentProps, Snippet } from "svelte";

import { cn, type WithoutChildrenOrChild } from "../../lib/utils.js";

import DialogPortal from "./dialog-portal.svelte";

import * as Dialog from "./index.js";

let {
	ref = $bindable(null),
	class: className,
	portalProps,
	children,
	showCloseButton = true,
	...restProps
}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
	portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
	children: Snippet;
	showCloseButton?: boolean;
} = $props();
</script>

<DialogPortal {...portalProps}>
	<Dialog.Overlay />
	<DialogPrimitive.Content
		bind:ref
		preventScroll={false}
		data-slot="dialog-content"
		class={cn(
			"bg-popover text-popover-foreground text-[0.6875rem]",
			"data-[state=open]:animate-in data-[state=closed]:animate-out",
			"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
			"fixed start-[50%] top-[50%] z-[var(--overlay-z)]",
			"grid w-full max-w-[calc(100%-2rem)] gap-0 p-3",
			"translate-x-[-50%] translate-y-[-50%]",
			"rounded-md border border-border/40 shadow-lg duration-200",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		{#if showCloseButton}
			<DialogPrimitive.Close
				class="ring-offset-background focus:ring-ring absolute end-2.5 top-2.5 rounded-xs opacity-50 transition-opacity hover:opacity-100 focus:ring-1 focus:ring-offset-1 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
			>
				<XIcon />
				<span class="sr-only">Close</span>
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</DialogPortal>
