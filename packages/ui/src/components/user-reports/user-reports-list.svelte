<script lang="ts">
	import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
	import type { ApiClient } from '@acepe/api';
	import type { ReportOutput, ReportCategory, ReportStatus, SortBy } from './types.js';
	import UserReportsListItem from './user-reports-list-item.svelte';
	import UserReportsSkeleton from './user-reports-skeleton.svelte';
	import UserReportsEmptyState from './user-reports-empty-state.svelte';

	interface Props {
		apiClient: ApiClient;
		category: ReportCategory | null;
		status: ReportStatus | null;
		sort: SortBy;
		search: string;
		onSelect: (id: string) => void;
		onCreateNew?: () => void;
	}

	let { apiClient, category, status, sort, search, onSelect, onCreateNew }: Props = $props();

	let page = $state(1);

	const queryClient = useQueryClient();

	// svelte-ignore state_referenced_locally
	const query = createQuery({
		queryKey: ['reports', { category, status, sort, search, page }],
		queryFn: () =>
			apiClient.reports.list({
				category: category ?? undefined,
				status: status ?? undefined,
				sort,
				search: search || undefined,
				page,
				limit: 20
			})
	});

	const voteMutation = createMutation({
		mutationFn: ({ id, value }: { id: string; value: 'up' | 'down' | null }) =>
			value ? apiClient.reports.vote(id, { voteType: value }) : apiClient.reports.removeVote(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports'] })
	});

	function handleVote(id: string, value: 'up' | 'down' | null) {
		$voteMutation.mutate({ id, value });
	}

	// Reset page when filters change
	$effect(() => {
		category;
		status;
		sort;
		search;
		page = 1;
	});
</script>

{#if $query.isLoading}
	<UserReportsSkeleton />
{:else if $query.data && $query.data.items.length > 0}
	<div class="flex flex-col">
		{#each $query.data.items as report (report.id)}
			<UserReportsListItem {report} {onSelect} onVote={handleVote} />
		{/each}
	</div>

	{#if $query.data.totalPages > 1}
		<div class="flex items-center justify-center gap-2 py-3 border-t border-border/20">
			<button
				type="button"
				class="text-[11px] px-2.5 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default hover:bg-accent/50 text-muted-foreground"
				disabled={page <= 1}
				onclick={() => (page = page - 1)}
			>
				← Prev
			</button>
			<span class="text-[10px] text-muted-foreground/60 tabular-nums font-mono">
				{page} / {$query.data.totalPages}
			</span>
			<button
				type="button"
				class="text-[11px] px-2.5 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default hover:bg-accent/50 text-muted-foreground"
				disabled={page >= $query.data.totalPages}
				onclick={() => (page = page + 1)}
			>
				Next →
			</button>
		</div>
	{/if}
{:else}
	<UserReportsEmptyState
		actionLabel={onCreateNew ? 'Create Report' : undefined}
		onAction={onCreateNew}
	/>
{/if}
