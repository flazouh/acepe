<script lang="ts">
	import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
	import { Users, Clock } from 'phosphor-svelte';
	import { cn } from '../../lib/utils.js';
	import type { ApiClient } from '@acepe/api';
	import { formatTimeAgo } from './types.js';
	import UserReportsCategoryBadge from './user-reports-category-badge.svelte';
	import UserReportsStatusBadge from './user-reports-status-badge.svelte';
	import UserReportsVoteButton from './user-reports-vote-button.svelte';
	import UserReportsCommentList from './user-reports-comment-list.svelte';

	interface Props {
		apiClient: ApiClient;
		reportId: string;
		onBack: () => void;
	}

	let { apiClient, reportId, onBack }: Props = $props();

	const queryClient = useQueryClient();

	// svelte-ignore state_referenced_locally
	const reportQuery = createQuery({
		queryKey: ['reports', reportId],
		queryFn: () => apiClient.reports.get(reportId)
	});

	// svelte-ignore state_referenced_locally
	const commentsQuery = createQuery({
		queryKey: ['comments', reportId],
		queryFn: () => apiClient.comments.list(reportId, { sort: 'oldest', limit: 100 })
	});

	const voteMutation = createMutation({
		mutationFn: (value: 'up' | 'down' | null) =>
			value
				? apiClient.reports.vote(reportId, { voteType: value })
				: apiClient.reports.removeVote(reportId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['reports', reportId] });
			queryClient.invalidateQueries({ queryKey: ['reports'] });
		}
	});

	const followMutation = createMutation({
		mutationFn: (following: boolean) =>
			following ? apiClient.reports.follow(reportId) : apiClient.reports.unfollow(reportId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports', reportId] })
	});

	const commentVoteMutation = createMutation({
		mutationFn: ({ commentId, value }: { commentId: string; value: 'up' | 'down' | null }) =>
			value
				? apiClient.comments.vote(reportId, commentId, { voteType: value })
				: apiClient.comments.removeVote(reportId, commentId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', reportId] })
	});

	const createCommentMutation = createMutation({
		mutationFn: ({ body, parentId }: { body: string; parentId?: string }) =>
			apiClient.comments.create(reportId, { body, parentId }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['comments', reportId] });
			queryClient.invalidateQueries({ queryKey: ['reports', reportId] });
		}
	});
</script>

{#if $reportQuery.data}
	{@const report = $reportQuery.data}
	<div class="flex flex-col overflow-y-auto">
		<!-- Header -->
		<div class="px-5 py-4 border-b border-border/20">
			<h2 class="text-[14px] font-semibold text-foreground leading-snug mb-2">{report.title}</h2>
			<div class="flex items-center gap-2.5 text-[10px] font-mono text-muted-foreground/70">
				{#if report.author.picture}
					<img src={report.author.picture} alt="" class="h-5 w-5 rounded-full" />
				{/if}
				<span class="font-medium text-foreground/80">{report.author.name ?? 'Anonymous'}</span>
				<span class="flex items-center gap-0.5">
					<Clock size={10} />
					{formatTimeAgo(report.createdAt)}
				</span>
				<UserReportsCategoryBadge category={report.category} size="sm" />
				<UserReportsStatusBadge status={report.status} />
			</div>
		</div>

		<!-- Body + vote + follow -->
		<div class="px-5 py-4 border-b border-border/20">
			<div class="flex gap-3">
				<UserReportsVoteButton
					score={report.upvoteCount - report.downvoteCount}
					userVote={report.currentUserVote}
					direction="vertical"
					size="md"
					onVote={(v) => $voteMutation.mutate(v)}
				/>
				<div class="flex-1 text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
					{report.body}
				</div>
			</div>

			<div class="flex items-center gap-3 mt-4">
				<button
					type="button"
					class={cn(
						'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer',
						report.currentUserFollowing
							? 'bg-primary/10 text-primary border border-primary/25'
							: 'bg-accent/40 text-muted-foreground hover:text-foreground border border-border/30'
					)}
					onclick={() => $followMutation.mutate(!report.currentUserFollowing)}
				>
					<Users size={12} />
					{report.currentUserFollowing ? 'Following' : 'Follow'}
				</button>
				<span class="text-[10px] text-muted-foreground/50">{report.followerCount} followers</span>
			</div>
		</div>

		<!-- Comments -->
		{#if $commentsQuery.data}
			<UserReportsCommentList
				comments={$commentsQuery.data.items}
				onVote={(commentId, value) => $commentVoteMutation.mutate({ commentId, value })}
				onReply={async (parentId, body) => {
					await $createCommentMutation.mutateAsync({ body, parentId });
				}}
				onNewComment={async (body) => {
					await $createCommentMutation.mutateAsync({ body });
				}}
			/>
		{/if}
	</div>
{:else if $reportQuery.isLoading}
	<div class="flex items-center justify-center py-16">
		<span class="text-[11px] text-muted-foreground/50">Loading...</span>
	</div>
{/if}
