<script lang="ts">
	import { NavigationMenu as NavigationMenuPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: NavigationMenuPrimitive.ViewportProps = $props();
</script>

<div class={cn('absolute start-0 top-full isolate z-50 flex justify-center')}>
	<NavigationMenuPrimitive.Viewport
		bind:ref
		data-slot="navigation-menu-viewport"
		class={cn(
			'relative z-50 mt-1.5 rounded-lg',
			'h-[var(--bits-navigation-menu-viewport-height)] w-full md:w-[var(--bits-navigation-menu-viewport-width)]',
			'bg-white/[0.04] backdrop-blur-[30px] will-change-transform',
			className
		)}
		{...restProps}
	/>
</div>
