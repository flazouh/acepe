<script lang="ts">
	import { CaretUp } from 'phosphor-svelte';
	import * as m from '$lib/paraglide/messages.js';
	import type { RoadmapCard } from './roadmap-state.svelte.js';
	import { CATEGORY_CONFIG, formatTimeAgo } from '@acepe/ui/user-reports';

	interface Props {
		card: RoadmapCard;
		isAuthenticated: boolean;
		onVote: (cardId: string, voteType: 'up' | 'down') => void;
	}

	let { card, isAuthenticated, onVote }: Props = $props();

	const categoryConfig = $derived(CATEGORY_CONFIG[card.category]);
	const CategoryIcon = $derived(categoryConfig.icon);
	const timeAgo = $derived(formatTimeAgo(card.createdAt));
	const isUpvoted = $derived(card.currentUserVote === 'up');

	function handleUpvote(e: MouseEvent) {
		e.stopPropagation();
		onVote(card.id, 'up');
	}
</script>

<article
	class="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-border/80"
	style="content-visibility: auto; contain-intrinsic-size: auto 72px;"
>
	<div class="flex items-start gap-3">
		<!-- Vote button -->
		<div class="flex flex-col items-center shrink-0">
			{#if isAuthenticated}
				<button
					type="button"
					class="flex items-center justify-center rounded h-6 w-6 transition-all duration-150 cursor-pointer {isUpvoted
						? 'text-primary scale-110'
						: 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/50'}"
					onclick={handleUpvote}
					aria-label="Upvote"
				>
					<CaretUp size={14} weight={isUpvoted ? 'fill' : 'bold'} />
				</button>
			{:else}
				<span
					class="flex items-center justify-center rounded h-6 w-6 text-muted-foreground/30 cursor-not-allowed"
					title={m.roadmap_login_to_vote()}
				>
					<CaretUp size={14} weight="bold" />
				</span>
			{/if}
			<span
				class="tabular-nums font-semibold font-mono select-none text-center text-[10px] min-w-[16px] {isUpvoted
					? 'text-primary'
					: 'text-muted-foreground'}"
			>
				{card.upvoteCount}
			</span>
		</div>

		<!-- Content -->
		<div class="flex-1 min-w-0">
			<h3 class="text-sm font-medium text-card-foreground leading-snug line-clamp-2">
				{card.title}
			</h3>
			<div class="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
				<span
					class="inline-flex items-center gap-0.5 rounded-full border px-1.5 h-4 font-medium font-mono uppercase tracking-wider shrink-0 {categoryConfig.classes}"
				>
					<CategoryIcon size={10} weight="fill" />
					{categoryConfig.label}
				</span>
				<span class="text-muted-foreground/50">{timeAgo}</span>
			</div>
		</div>
	</div>
</article>
