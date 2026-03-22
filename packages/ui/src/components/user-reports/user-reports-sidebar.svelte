<script lang="ts">
	import {
		BugIcon,
		LightbulbIcon,
		QuestionIcon,
		ChatCircleIcon,
		CircleIcon,
		CircleHalfIcon,
		CheckCircleIcon,
		XCircleIcon,
		SortAscendingIcon,
		FunnelSimpleIcon,
		RowsIcon
	} from 'phosphor-svelte';
	import { cn } from '../../lib/utils.js';
	import type { ReportCategory, ReportStatus, SortBy } from './types.js';

	interface Props {
		activeCategory: ReportCategory | null;
		activeStatus: ReportStatus | null;
		sortOrder: SortBy;
		onCategoryChange: (c: ReportCategory | null) => void;
		onStatusChange: (s: ReportStatus | null) => void;
		onSortChange: (s: SortBy) => void;
	}

	let { activeCategory, activeStatus, sortOrder, onCategoryChange, onStatusChange, onSortChange }: Props = $props();

	const categories = [
		{ value: null, label: 'All', icon: RowsIcon },
		{ value: 'bug' as const, label: 'Bugs', icon: BugIcon },
		{ value: 'feature_request' as const, label: 'Features', icon: LightbulbIcon },
		{ value: 'question' as const, label: 'Questions', icon: QuestionIcon },
		{ value: 'discussion' as const, label: 'Discussions', icon: ChatCircleIcon }
	];

	const statuses: { value: ReportStatus | null; label: string; icon?: typeof CircleIcon; color?: string }[] = [
		{ value: null, label: 'Any status' },
		{ value: 'open', label: 'Open', icon: CircleIcon, color: 'text-success' },
		{ value: 'in_progress', label: 'In Progress', icon: CircleHalfIcon, color: 'text-primary' },
		{ value: 'completed', label: 'Completed', icon: CheckCircleIcon, color: 'text-success' },
		{ value: 'closed', label: 'Closed', icon: XCircleIcon, color: 'text-muted-foreground' }
	];

	const sorts: { value: SortBy; label: string }[] = [
		{ value: 'newest', label: 'Newest' },
		{ value: 'most_upvoted', label: 'Top voted' },
		{ value: 'most_commented', label: 'Most discussed' },
		{ value: 'trending', label: 'Trending' }
	];
</script>

<aside class="w-44 shrink-0 border-r border-border/30 flex flex-col py-1.5 overflow-y-auto">
	<div class="px-2.5 py-1">
		<span class="text-[9px] font-semibold font-mono text-muted-foreground/50 uppercase tracking-[0.1em]">Category</span>
	</div>
	{#each categories as cat}
		{@const isActive = activeCategory === cat.value}
		<button
			type="button"
			class={cn(
				'flex items-center gap-2 px-2.5 py-1.5 mx-1 rounded-md text-[11px] font-mono cursor-pointer transition-colors',
				isActive
					? 'bg-accent/60 text-foreground font-medium'
					: 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
			)}
			onclick={() => onCategoryChange(cat.value)}
		>
			<cat.icon size={13} weight={isActive ? 'fill' : 'regular'} class="shrink-0" />
			<span class="flex-1 text-left">{cat.label}</span>
		</button>
	{/each}

	<div class="h-px bg-border/20 mx-3 my-2"></div>

	<div class="px-2.5 py-1">
		<span class="text-[9px] font-semibold font-mono text-muted-foreground/50 uppercase tracking-[0.1em]">Status</span>
	</div>
	{#each statuses as s}
		{@const isActive = activeStatus === s.value}
		<button
			type="button"
			class={cn(
				'flex items-center gap-2 px-2.5 py-1.5 mx-1 rounded-md text-[11px] font-mono cursor-pointer transition-colors',
				isActive
					? 'bg-accent/60 text-foreground font-medium'
					: 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
			)}
			onclick={() => onStatusChange(s.value)}
		>
			{#if s.icon}
				<s.icon size={11} weight="fill" class={cn('shrink-0', s.color)} />
			{:else}
				<FunnelSimpleIcon size={11} class="shrink-0" />
			{/if}
			<span class="flex-1 text-left">{s.label}</span>
		</button>
	{/each}

	<div class="h-px bg-border/20 mx-3 my-2"></div>

	<div class="px-2.5 py-1">
		<span class="text-[9px] font-semibold font-mono text-muted-foreground/50 uppercase tracking-[0.1em]">Sort by</span>
	</div>
	{#each sorts as s}
		{@const isActive = sortOrder === s.value}
		<button
			type="button"
			class={cn(
				'flex items-center gap-2 px-2.5 py-1.5 mx-1 rounded-md text-[11px] font-mono cursor-pointer transition-colors',
				isActive
					? 'bg-accent/60 text-foreground font-medium'
					: 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
			)}
			onclick={() => onSortChange(s.value)}
		>
			<SortAscendingIcon size={11} class="shrink-0" />
			<span class="flex-1 text-left">{s.label}</span>
		</button>
	{/each}
</aside>
