<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		children,
		child,
		...restProps
	}: DropdownMenuPrimitive.TriggerProps = $props();
</script>

<DropdownMenuPrimitive.Trigger
	bind:ref
	data-slot={child ? "button" : "dropdown-menu-trigger"}
	class={child ? undefined : "cursor-pointer"}
	{child}
	{...restProps}
>
	{@render children?.()}
</DropdownMenuPrimitive.Trigger>
