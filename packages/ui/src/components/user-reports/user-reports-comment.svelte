<script lang="ts">
	import { ArrowBendUpLeft, Clock } from 'phosphor-svelte';
	import { cn } from '../../lib/utils.js';
	import type { CommentOutput } from './types.js';
	import { formatTimeAgo } from './types.js';
	import UserReportsVoteButton from './user-reports-vote-button.svelte';
	import UserReportsCommentForm from './user-reports-comment-form.svelte';
	import UserReportsComment from './user-reports-comment.svelte';

	interface Props {
		comment: CommentOutput;
		depth?: number;
		onVote: (commentId: string, value: 'up' | 'down' | null) => void;
		onReply: (parentId: string, body: string) => Promise<void>;
	}

	let { comment, depth = 0, onVote, onReply }: Props = $props();

	let replying = $state(false);
</script>

<div class={cn('flex gap-2', depth > 0 && 'ml-5 pl-3 border-l-2 border-border/25')}>
	<UserReportsVoteButton
		score={comment.upvoteCount - comment.downvoteCount}
		userVote={comment.currentUserVote}
		direction="vertical"
		size="sm"
		onVote={(v) => onVote(comment.id, v)}
		class="pt-1 shrink-0"
	/>

	<div class="flex-1 min-w-0 py-1.5">
		<div class="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/70 mb-1">
			{#if comment.author.picture}
				<img src={comment.author.picture} alt="" class="h-4 w-4 rounded-full" />
			{:else}
				<div class="h-4 w-4 rounded-full bg-accent"></div>
			{/if}
			<span class="font-medium text-foreground/80">{comment.author.name ?? 'Anonymous'}</span>
			<span class="flex items-center gap-0.5">
				<Clock size={9} />
				{formatTimeAgo(comment.createdAt)}
			</span>
		</div>

		<div class="text-[12px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
			{comment.body}
		</div>

		{#if depth === 0}
			<div class="mt-1.5">
				<button
					type="button"
					class="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer transition-colors"
					onclick={() => (replying = !replying)}
				>
					<ArrowBendUpLeft size={10} />
					Reply
				</button>
			</div>
		{/if}

		{#if replying}
			<div class="mt-2">
				<UserReportsCommentForm
					placeholder="Write a reply..."
					submitLabel="Reply"
					autofocus
					onSubmit={async (body) => {
						await onReply(comment.id, body);
						replying = false;
					}}
					onCancel={() => (replying = false)}
				/>
			</div>
		{/if}

		{#if comment.replies && comment.replies.length > 0}
			<div class="flex flex-col gap-0 mt-2">
				{#each comment.replies as reply (reply.id)}
					<UserReportsComment comment={reply} depth={1} {onVote} {onReply} />
				{/each}
			</div>
		{/if}
	</div>
</div>
