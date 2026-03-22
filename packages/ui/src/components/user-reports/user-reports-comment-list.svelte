<script lang="ts">
	import type { CommentOutput } from './types.js';
	import UserReportsComment from './user-reports-comment.svelte';
	import UserReportsCommentForm from './user-reports-comment-form.svelte';

	interface Props {
		comments: CommentOutput[];
		onVote: (commentId: string, value: 'up' | 'down' | null) => void;
		onReply: (parentId: string, body: string) => Promise<void>;
		onNewComment: (body: string) => Promise<void>;
	}

	let { comments, onVote, onReply, onNewComment }: Props = $props();
</script>

<div class="flex flex-col">
	<div class="border-b border-border/20 px-5 py-2.5">
		<span class="text-[11px] font-semibold font-mono text-muted-foreground/70"
			>{comments.length} Comment{comments.length !== 1 ? 's' : ''}</span
		>
	</div>

	<div class="flex flex-col gap-0 px-5">
		{#each comments as comment (comment.id)}
			<div class="py-2.5 border-b border-border/15">
				<UserReportsComment {comment} {onVote} {onReply} />
			</div>
		{/each}
	</div>

	<div class="px-5 py-3">
		<UserReportsCommentForm onSubmit={onNewComment} />
	</div>
</div>
