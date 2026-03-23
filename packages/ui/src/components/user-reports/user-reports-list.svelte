<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import type { GitHubService, IssueCategory, IssueState } from './types.js';
	import { unwrapResult } from './types.js';
	import UserReportsListItem from './user-reports-list-item.svelte';
	import UserReportsSkeleton from './user-reports-skeleton.svelte';
	import UserReportsEmptyState from './user-reports-empty-state.svelte';

	interface Props {
		service: GitHubService;
		category: IssueCategory | null;
		state: IssueState | 'open';
		sort: string;
		search: string;
		page: number;
		onSelect: (issueNumber: number) => void;
		onPageChange: (page: number) => void;
		onCreateNew?: () => void;
	}

	let { service, category, state, sort, search, page, onSelect, onPageChange, onCreateNew }: Props = $props();

	const isSearch = $derived(search.length > 0);

	const query = createQuery({
		queryKey: ['issues', { category, state, sort, search, page }],
		queryFn: () => {
			if (isSearch) {
				return unwrapResult(
					service.searchIssues({
						query: search,
						state: state ? state : undefined,
						labels: category ? category : undefined,
						sort: sort === 'comments' ? 'comments' : undefined,
						page,
						perPage: 20
					})
				);
			}
			return unwrapResult(
				service.listIssues({
					state: state ? state : 'open',
					labels: category ? category : undefined,
					sort,
					direction: sort === 'created' ? 'desc' : undefined,
					page,
					perPage: 20
				})
			);
		}
	});
</script>

{#if $query.isLoading}
	<UserReportsSkeleton />
{:else if $query.isError}
	<div class="flex flex-col items-center justify-center py-16 px-4 gap-2">
		<span class="text-[11px] font-mono text-destructive/80">Failed to load issues</span>
		<span class="text-[10px] text-muted-foreground/50 text-center max-w-xs">
			{$query.error instanceof Error ? $query.error.message : 'An unexpected error occurred'}
		</span>
		<button
			type="button"
			class="mt-2 text-[10px] font-mono text-primary hover:text-primary/80 transition-colors cursor-pointer"
			onclick={() => $query.refetch()}
		>
			Retry
		</button>
	</div>
{:else if $query.data && $query.data.items.length > 0}
	<div class="flex flex-col">
		{#each $query.data.items as issue (issue.number)}
			<UserReportsListItem {issue} {onSelect} />
		{/each}
	</div>

	{#if $query.data.hasNextPage || page > 1}
		<div class="flex items-center justify-center gap-2 py-3 border-t border-border/20">
			<button
				type="button"
				class="text-[11px] px-2.5 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default hover:bg-accent/50 text-muted-foreground"
				disabled={page <= 1}
				onclick={() => onPageChange(page - 1)}
			>
				← Prev
			</button>
			<span class="text-[10px] text-muted-foreground/60 tabular-nums font-mono">
				Page {page}
			</span>
			<button
				type="button"
				class="text-[11px] px-2.5 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default hover:bg-accent/50 text-muted-foreground"
				disabled={!$query.data.hasNextPage}
				onclick={() => onPageChange(page + 1)}
			>
				Next →
			</button>
		</div>
	{/if}
{:else}
	<UserReportsEmptyState
		actionLabel={onCreateNew ? 'Create Issue' : undefined}
		onAction={onCreateNew}
	/>
{/if}
