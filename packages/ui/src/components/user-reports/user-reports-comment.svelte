<script lang="ts">
	import { ArrowSquareOut, Clock } from 'phosphor-svelte';
	import { cn } from '../../lib/utils.js';
	import type { GitHubComment, GitHubService } from './types.js';
	import { formatTimeAgo, unwrapResult } from './types.js';
	import { createMutation, useQueryClient } from '@tanstack/svelte-query';

	interface Props {
		comment: GitHubComment;
		service: GitHubService;
	}

	let { comment, service }: Props = $props();

	const queryClient = useQueryClient();

	const reactionMutation = createMutation({
		mutationFn: (content: string) => unwrapResult(service.toggleCommentReaction(comment.id, content)),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['comments'] });
		}
	});

	const REACTIONS = [
		{ content: '+1', emoji: '👍', key: 'plus1' as const },
		{ content: 'heart', emoji: '❤️', key: 'heart' as const },
		{ content: 'rocket', emoji: '🚀', key: 'rocket' as const },
		{ content: 'eyes', emoji: '👀', key: 'eyes' as const }
	];
</script>

<div class="flex gap-2">
	<div class="flex-1 min-w-0 py-1.5">
		<div class="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/70 mb-1">
			<img src={comment.author.avatarUrl} alt="" class="h-4 w-4 rounded-full" />
			<span class="font-medium text-foreground/80">{comment.author.login}</span>
			<span class="flex items-center gap-0.5">
				<Clock size={9} />
				{formatTimeAgo(comment.createdAt)}
			</span>
			<button
				type="button"
				class="ml-auto flex items-center gap-0.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors cursor-pointer"
				onclick={() => window.open(comment.htmlUrl, '_blank', 'noopener,noreferrer')}
			>
				<ArrowSquareOut size={9} />
			</button>
		</div>

		<div class="text-[12px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
			{comment.body}
		</div>

		{#if comment.reactions.totalCount > 0}
			<div class="flex items-center gap-1 mt-2">
				{#each REACTIONS as r}
					{@const count = comment.reactions[r.key]}
					{#if count > 0}
						<button
							type="button"
							class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-accent/30 text-muted-foreground border border-border/20 hover:bg-accent/50 transition-colors cursor-pointer"
							disabled={$reactionMutation.isPending}
							onclick={() => $reactionMutation.mutate(r.content)}
						>
							<span>{r.emoji}</span>
							<span class="tabular-nums">{count}</span>
						</button>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>
