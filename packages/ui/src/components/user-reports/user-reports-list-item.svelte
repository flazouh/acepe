<script lang="ts">
	import { ChatDots, Clock } from 'phosphor-svelte';
	import { cn } from '../../lib/utils.js';
	import type { ReportOutput } from './types.js';
	import { formatTimeAgo } from './types.js';
	import UserReportsCategoryBadge from './user-reports-category-badge.svelte';
	import UserReportsStatusBadge from './user-reports-status-badge.svelte';
	import UserReportsVoteButton from './user-reports-vote-button.svelte';

	interface Props {
		report: ReportOutput;
		onSelect: (id: string) => void;
		onVote: (id: string, value: 'up' | 'down' | null) => void;
	}

	let { report, onSelect, onVote }: Props = $props();

	const timeAgo = $derived(formatTimeAgo(report.createdAt));
	const excerpt = $derived(
		report.body.length > 120 ? report.body.slice(0, 120).trimEnd() + '…' : report.body
	);
</script>

<button
	type="button"
	class="group flex items-start gap-2.5 px-3 py-2.5 w-full text-left cursor-pointer border-b border-border/20 transition-colors hover:bg-accent/30"
	onclick={() => onSelect(report.id)}
>
	<UserReportsVoteButton
		score={report.upvoteCount - report.downvoteCount}
		userVote={report.currentUserVote}
		direction="vertical"
		size="sm"
		onVote={(v) => onVote(report.id, v)}
		class="pt-0.5"
	/>

	<div class="flex-1 min-w-0 flex flex-col gap-1">
		<div class="flex items-center gap-1.5">
			{#if report.isPinned}
				<span class="text-[9px] font-bold text-primary uppercase tracking-widest font-mono">PIN</span>
			{/if}
			<span
				class="text-[12px] font-medium text-foreground truncate leading-tight group-hover:text-primary transition-colors"
			>
				{report.title}
			</span>
		</div>

		<p class="text-[11px] text-muted-foreground/60 leading-snug line-clamp-1">
			{excerpt}
		</p>

		<div class="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/70">
			<UserReportsCategoryBadge category={report.category} size="xs" />
			<UserReportsStatusBadge status={report.status} />
			<span class="flex items-center gap-0.5 tabular-nums">
				<ChatDots size={10} />
				{report.commentCount}
			</span>
			<span class="flex items-center gap-0.5 tabular-nums">
				<Clock size={10} />
				{timeAgo}
			</span>
		</div>
	</div>
</button>
