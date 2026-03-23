<script lang="ts">
	import { ChatDots, Clock } from 'phosphor-svelte';
	import type { GitHubIssue } from './types.js';
	import { formatTimeAgo, getIssueCategory } from './types.js';
	import UserReportsCategoryBadge from './user-reports-category-badge.svelte';
	import UserReportsStatusBadge from './user-reports-status-badge.svelte';

	interface Props {
		issue: GitHubIssue;
		onSelect: (issueNumber: number) => void;
	}

	let { issue, onSelect }: Props = $props();

	const timeAgo = $derived(formatTimeAgo(issue.createdAt));
	const category = $derived(getIssueCategory(issue.labels));
	const excerpt = $derived(
		issue.body.length > 120 ? issue.body.slice(0, 120).trimEnd() + '…' : issue.body
	);
	const totalReactions = $derived(issue.reactions.totalCount);
</script>

<button
	type="button"
	class="group flex items-start gap-2.5 px-3 py-2.5 w-full text-left cursor-pointer border-b border-border/20 transition-colors hover:bg-accent/30"
	onclick={() => onSelect(issue.number)}
>
	<div class="flex-1 min-w-0 flex flex-col gap-1">
		<div class="flex items-center gap-1.5">
			<span class="text-[10px] font-mono text-muted-foreground/40">#{issue.number}</span>
			<span
				class="text-[12px] font-medium text-foreground truncate leading-tight group-hover:text-primary transition-colors"
			>
				{issue.title}
			</span>
		</div>

		{#if excerpt}
			<p class="text-[11px] text-muted-foreground/60 leading-snug line-clamp-1">
				{excerpt}
			</p>
		{/if}

		<div class="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/70">
			{#if category}
				<UserReportsCategoryBadge {category} size="xs" />
			{/if}
			<UserReportsStatusBadge status={issue.state} />
			{#if totalReactions > 0}
				<span class="flex items-center gap-0.5 tabular-nums">
					👍 {totalReactions}
				</span>
			{/if}
			<span class="flex items-center gap-0.5 tabular-nums">
				<ChatDots size={10} />
				{issue.commentsCount}
			</span>
			<span class="flex items-center gap-0.5 tabular-nums">
				<Clock size={10} />
				{timeAgo}
			</span>
		</div>
	</div>
</button>
