<script lang="ts">
import { AlertDialog as AlertDialogPrimitive } from "bits-ui";

import { buttonVariants } from "$lib/components/ui/button/index.js";
import { cn } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	...restProps
}: AlertDialogPrimitive.ActionProps = $props();
</script>

<AlertDialogPrimitive.Action
	bind:ref
	data-slot="alert-dialog-action"
	class={cn(buttonVariants({ size: "sm" }), "h-7 text-[0.6875rem] rounded-md", className)}
	{...restProps}
/>
