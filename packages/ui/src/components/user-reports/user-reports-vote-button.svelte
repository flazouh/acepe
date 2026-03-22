<script lang="ts">
	import { CaretUp, CaretDown } from 'phosphor-svelte';
	import { cn } from '../../lib/utils.js';

	interface Props {
		score: number;
		userVote: 'up' | 'down' | null;
		direction?: 'vertical' | 'horizontal';
		size?: 'sm' | 'md';
		onVote: (value: 'up' | 'down' | null) => void;
		class?: string;
	}

	let { score, userVote, direction = 'vertical', size = 'md', onVote, class: className }: Props =
		$props();

	const iconSize = { sm: 14, md: 16 };

	function handleUp(e: MouseEvent) {
		e.stopPropagation();
		onVote(userVote === 'up' ? null : 'up');
	}

	function handleDown(e: MouseEvent) {
		e.stopPropagation();
		onVote(userVote === 'down' ? null : 'down');
	}
</script>

<div
	class={cn(
		'flex items-center shrink-0',
		direction === 'vertical' ? 'flex-col gap-0' : 'flex-row gap-1',
		className
	)}
>
	<button
		type="button"
		class={cn(
			'flex items-center justify-center rounded transition-all duration-150 cursor-pointer',
			size === 'sm' ? 'h-5 w-5' : 'h-6 w-6',
			userVote === 'up'
				? 'text-primary scale-110'
				: 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/50'
		)}
		onclick={handleUp}
		aria-label="Upvote"
	>
		<CaretUp size={iconSize[size]} weight={userVote === 'up' ? 'fill' : 'bold'} />
	</button>

	<span
		class={cn(
			'tabular-nums font-semibold font-mono select-none text-center',
			size === 'sm' ? 'text-[10px] min-w-[16px]' : 'text-[11px] min-w-[20px]',
			userVote === 'up' && 'text-primary',
			userVote === 'down' && 'text-destructive',
			!userVote && 'text-muted-foreground'
		)}
	>
		{score}
	</span>

	<button
		type="button"
		class={cn(
			'flex items-center justify-center rounded transition-all duration-150 cursor-pointer',
			size === 'sm' ? 'h-5 w-5' : 'h-6 w-6',
			userVote === 'down'
				? 'text-destructive scale-110'
				: 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/50'
		)}
		onclick={handleDown}
		aria-label="Downvote"
	>
		<CaretDown size={iconSize[size]} weight={userVote === 'down' ? 'fill' : 'bold'} />
	</button>
</div>
