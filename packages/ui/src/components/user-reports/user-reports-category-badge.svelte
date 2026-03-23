<script lang="ts">
	import { cn } from '../../lib/utils.js';
	import { CATEGORY_CONFIG } from './types.js';
	import type { IssueCategory } from './types.js';

	interface Props {
		category: IssueCategory;
		size?: 'xs' | 'sm';
		class?: string;
	}

	let { category, size = 'xs', class: className }: Props = $props();

	const sizeClasses = {
		xs: 'h-4 px-1.5 text-[9px] gap-0.5',
		sm: 'h-5 px-2 text-[10px] gap-1'
	};

	const iconSize = { xs: 10, sm: 12 };

	const c = $derived(CATEGORY_CONFIG[category]);
</script>

<span
	class={cn(
		'inline-flex items-center rounded-full border font-medium font-mono uppercase tracking-wider shrink-0',
		c.classes,
		sizeClasses[size],
		className
	)}
>
	<c.icon size={iconSize[size]} weight="fill" />
	{c.label}
</span>
