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
	data-slot="dropdown-menu-trigger"
	class="cursor-pointer"
	{child}
	{...restProps}
>
	{@render children?.()}
</DropdownMenuPrimitive.Trigger>
