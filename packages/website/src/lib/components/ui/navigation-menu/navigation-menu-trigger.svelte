<script lang="ts" module>
	import { cn } from '$lib/utils.js';
	import { tv } from 'tailwind-variants';

	export const navigationMenuTriggerStyle = tv({
		base: 'group inline-flex h-9 w-max items-center justify-center px-2 py-2 text-sm font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50'
	});
</script>

<script lang="ts">
	import { NavigationMenu as NavigationMenuPrimitive } from 'bits-ui';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

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
	class={cn(navigationMenuTriggerStyle(), 'group', className)}
	{...restProps}
>
	{@render children?.()}

	<ChevronDownIcon
		class="relative top-[1px] ms-1 size-3 transition duration-300 group-data-[state=open]:rotate-180"
		aria-hidden="true"
	/>
</NavigationMenuPrimitive.Trigger>
