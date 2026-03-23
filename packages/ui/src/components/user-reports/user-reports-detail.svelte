<script lang="ts">
	import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
	import { ArrowSquareOut, Clock } from 'phosphor-svelte';
	import { cn } from '../../lib/utils.js';
	import type { GitHubService } from './types.js';
	import { formatTimeAgo, getIssueCategory, unwrapResult } from './types.js';
	import UserReportsCategoryBadge from './user-reports-category-badge.svelte';
	import UserReportsStatusBadge from './user-reports-status-badge.svelte';
	import UserReportsCommentList from './user-reports-comment-list.svelte';

	interface Props {
		service: GitHubService;
		issueNumber: number;
		onBack: () => void;
	}

	let { service, issueNumber, onBack }: Props = $props();

	const queryClient = useQueryClient();

	// svelte-ignore state_referenced_locally
	const issueQuery = createQuery({
		queryKey: ['issue', issueNumber],
		queryFn: () => unwrapResult(service.getIssue(issueNumber))
	});

	// svelte-ignore state_referenced_locally
	const commentsQuery = createQuery({
		queryKey: ['comments', issueNumber],
		queryFn: () => unwrapResult(service.listComments(issueNumber))
	});

	const reactionMutation = createMutation({
		mutationFn: (content: string) => unwrapResult(service.toggleIssueReaction(issueNumber, content)),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['issue', issueNumber] });
			queryClient.invalidateQueries({ queryKey: ['issues'] });
		}
	});

	const commentMutation = createMutation({
		mutationFn: (body: string) => unwrapResult(service.createComment(issueNumber, body)),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['comments', issueNumber] });
			queryClient.invalidateQueries({ queryKey: ['issue', issueNumber] });
		}
	});

	const REACTIONS = [
		{ content: '+1', emoji: '👍', key: 'plus1' as const },
		{ content: 'heart', emoji: '❤️', key: 'heart' as const },
		{ content: 'rocket', emoji: '🚀', key: 'rocket' as const },
		{ content: 'eyes', emoji: '👀', key: 'eyes' as const }
	];
</script>

{#if $issueQuery.data}
	{@const issue = $issueQuery.data}
	{@const category = getIssueCategory(issue.labels)}
	<div class="flex flex-col overflow-y-auto">
		<!-- Header -->
		<div class="px-5 py-4 border-b border-border/20">
			<h2 class="text-[14px] font-semibold text-foreground leading-snug mb-2">{issue.title}</h2>
			<div class="flex items-center gap-2.5 text-[10px] font-mono text-muted-foreground/70">
				<img src={issue.author.avatarUrl} alt="" class="h-5 w-5 rounded-full" />
				<span class="font-medium text-foreground/80">{issue.author.login}</span>
				<span class="flex items-center gap-0.5">
					<Clock size={10} />
					{formatTimeAgo(issue.createdAt)}
				</span>
				{#if category}
					<UserReportsCategoryBadge {category} size="sm" />
				{/if}
				<UserReportsStatusBadge status={issue.state} />
				<button
					type="button"
					class="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer"
					onclick={() => window.open(issue.htmlUrl, '_blank', 'noopener,noreferrer')}
				>
					<ArrowSquareOut size={10} />
					GitHub
				</button>
			</div>
		</div>

		<!-- Body + reactions -->
		<div class="px-5 py-4 border-b border-border/20">
			<div class="text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
				{issue.body}
			</div>

			<div class="flex items-center gap-1.5 mt-4">
				{#each REACTIONS as r}
					{@const count = issue.reactions[r.key]}
					<button
						type="button"
						class={cn(
							'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors cursor-pointer border',
							count > 0
								? 'bg-accent/40 text-foreground border-border/30'
								: 'bg-transparent text-muted-foreground/40 border-transparent hover:bg-accent/20 hover:text-muted-foreground'
						)}
						disabled={$reactionMutation.isPending}
						onclick={() => $reactionMutation.mutate(r.content)}
					>
						<span>{r.emoji}</span>
						{#if count > 0}
							<span class="tabular-nums">{count}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- Comments -->
		{#if $commentsQuery.data}
			<UserReportsCommentList
				comments={$commentsQuery.data}
				{service}
				onNewComment={async (body) => {
					await $commentMutation.mutateAsync(body);
				}}
			/>
		{/if}
	</div>
{:else if $issueQuery.isLoading}
	<div class="flex items-center justify-center py-16">
		<span class="text-[11px] text-muted-foreground/50">Loading...</span>
	</div>
{:else if $issueQuery.isError}
	<div class="flex flex-col items-center justify-center py-16 px-4 gap-2">
		<span class="text-[11px] font-mono text-destructive/80">Failed to load issue</span>
		<span class="text-[10px] text-muted-foreground/50 text-center max-w-xs">
			{$issueQuery.error instanceof Error ? $issueQuery.error.message : 'An unexpected error occurred'}
		</span>
		<div class="flex items-center gap-3 mt-2">
			<button
				type="button"
				class="text-[10px] font-mono text-primary hover:text-primary/80 transition-colors cursor-pointer"
				onclick={() => $issueQuery.refetch()}
			>
				Retry
			</button>
			<button
				type="button"
				class="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
				onclick={onBack}
			>
				Back to list
			</button>
		</div>
	</div>
{/if}
