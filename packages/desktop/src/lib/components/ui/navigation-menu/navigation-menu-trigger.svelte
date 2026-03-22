<script lang="ts" module>
import { tv } from "tailwind-variants";
import { cn } from "$lib/utils.js";

export const navigationMenuTriggerStyle = tv({
	base: "cursor-pointer group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm outline-none transition-[color,box-shadow] hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent/50 data-[state=open]:text-accent-foreground data-[state=open]:focus:bg-accent data-[state=open]:hover:bg-accent",
});
</script>

<script lang="ts">
	import { NavigationMenu as NavigationMenuPrimitive } from "bits-ui";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: NavigationMenuPrimitive.TriggerProps = $props();
</script>

<NavigationMenuPrimitive.Trigger
	bind:ref
	data-slot="navigation-menu-trigger"
	class={cn(navigationMenuTriggerStyle(), "group", className)}
	{...restProps}
>
	{@render children?.()}

	<ChevronDownIcon
		class="relative top-[1px] ms-1 size-3 transition duration-300 group-data-[state=open]:rotate-180"
		aria-hidden="true"
	/>
</NavigationMenuPrimitive.Trigger>
