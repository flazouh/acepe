<script lang="ts">
import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
import type { ComponentProps } from "svelte";

import { cn, type WithoutChild, type WithoutChildrenOrChild } from "$lib/utils.js";
import AlertDialogOverlay from "./alert-dialog-overlay.svelte";
import AlertDialogPortal from "./alert-dialog-portal.svelte";

let {
	ref = $bindable(null),
	class: className,
	portalProps,
	...restProps
}: WithoutChild<AlertDialogPrimitive.ContentProps> & {
	portalProps?: WithoutChildrenOrChild<ComponentProps<typeof AlertDialogPortal>>;
} = $props();
</script>

<AlertDialogPortal {...portalProps}>
	<AlertDialogOverlay />
	<AlertDialogPrimitive.Content
		bind:ref
		data-slot="alert-dialog-content"
		class={cn(
			"bg-background text-[0.6875rem] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed start-[50%] top-[50%] z-[var(--overlay-z)] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-0 rounded-md border border-border/40 p-3 shadow-lg duration-200 sm:max-w-lg",
			className
		)}
		{...restProps}
	/>
</AlertDialogPortal>
