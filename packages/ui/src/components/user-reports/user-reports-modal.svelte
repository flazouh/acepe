<script lang="ts">
	import { Dialog } from 'bits-ui';
	import * as DropdownMenu from '../dropdown-menu/index.js';
	import { ArrowLeft, CaretDown, Check, MagnifyingGlass, Plus } from 'phosphor-svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import {
		CloseAction,
		EmbeddedIconButton,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell
	} from '../panel-header/index.js';
	import type { ApiClient } from '@acepe/api';
	import type { ReportCategory, ReportStatus, SortBy, View } from './types.js';
	import { CATEGORY_CONFIG, STATUS_CONFIG } from './types.js';
	import { cn } from '../../lib/utils.js';

	import UserReportsCreate from './user-reports-create.svelte';
	import UserReportsDetail from './user-reports-detail.svelte';
	import UserReportsList from './user-reports-list.svelte';

	interface Props {
		open: boolean;
		apiClient: ApiClient;
		onClose: () => void;
	}

	let { open = $bindable(), apiClient, onClose }: Props = $props();

	let view = $state<View>({ kind: 'list' });
	let searchQuery = $state('');
	let activeCategory = $state<ReportCategory | null>(null);
	let activeStatus = $state<ReportStatus | null>(null);
	let sortOrder = $state<SortBy>('newest');
	let searchOpen = $state(false);

	const queryClient = new QueryClient({
		defaultOptions: { queries: { staleTime: 30_000 } }
	});

	const title = $derived(
		view.kind === 'create'
			? 'New Report'
			: view.kind === 'detail'
				? 'Report'
				: 'Feedback'
	);

	const categories: { value: ReportCategory | null; label: string }[] = [
		{ value: null, label: 'All Types' },
		{ value: 'bug', label: 'Bug' },
		{ value: 'feature_request', label: 'Feature' },
		{ value: 'question', label: 'Question' },
		{ value: 'discussion', label: 'Discussion' }
	];

	const statuses: { value: ReportStatus | null; label: string }[] = [
		{ value: null, label: 'Any Status' },
		{ value: 'open', label: 'Open' },
		{ value: 'in_progress', label: 'In Progress' },
		{ value: 'completed', label: 'Done' },
		{ value: 'closed', label: 'Closed' }
	];

	const sorts: { value: SortBy; label: string }[] = [
		{ value: 'newest', label: 'Newest' },
		{ value: 'most_upvoted', label: 'Top voted' },
		{ value: 'most_commented', label: 'Most discussed' },
		{ value: 'trending', label: 'Trending' }
	];

	const activeCategoryLabel = $derived(
		categories.find((c) => c.value === activeCategory)?.label ?? 'All Types'
	);
	const activeStatusLabel = $derived(
		statuses.find((s) => s.value === activeStatus)?.label ?? 'Any Status'
	);
	const activeSortLabel = $derived(
		sorts.find((s) => s.value === sortOrder)?.label ?? 'Newest'
	);

	function handleBack() {
		view = { kind: 'list' };
	}

	function handleOpenChange(isOpen: boolean) {
		if (!isOpen) {
			onClose();
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class="fixed start-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] w-[680px] max-w-[calc(100vw-3rem)] h-[80vh] max-h-[700px] flex flex-col rounded-xl border border-border/40 bg-background shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200"
		>
			<QueryClientProvider client={queryClient}>
				<!-- Header bar -->
				<EmbeddedPanelHeader>
					{#if view.kind !== 'list'}
						<EmbeddedIconButton
							title="Back"
							ariaLabel="Back to list"
							onclick={handleBack}
						>
							{#snippet children()}
								<ArrowLeft size={14} weight="bold" />
							{/snippet}
						</EmbeddedIconButton>
					{/if}

					<HeaderTitleCell>
						{#snippet children()}
							<span
								class="text-[11px] font-semibold font-mono text-foreground tracking-wide uppercase select-none"
							>
								{title}
							</span>
						{/snippet}
					</HeaderTitleCell>

					<HeaderActionCell withDivider={false}>
						{#snippet children()}
							{#if view.kind === 'list'}
								<EmbeddedIconButton
									title="Search"
									ariaLabel="Search reports"
									active={searchOpen}
									onclick={() => {
										searchOpen = !searchOpen;
										if (!searchOpen) searchQuery = '';
									}}
								>
									{#snippet children()}
										<MagnifyingGlass size={14} weight="bold" />
									{/snippet}
								</EmbeddedIconButton>

								<EmbeddedIconButton
									title="New report"
									ariaLabel="Create new report"
									onclick={() => (view = { kind: 'create' })}
								>
									{#snippet children()}
										<Plus size={14} weight="bold" />
									{/snippet}
								</EmbeddedIconButton>
							{/if}
						{/snippet}
					</HeaderActionCell>

					<HeaderActionCell>
						{#snippet children()}
							<CloseAction onClose={onClose} />
						{/snippet}
					</HeaderActionCell>
				</EmbeddedPanelHeader>

				<!-- Search bar (collapsible) -->
				{#if searchOpen && view.kind === 'list'}
					<div class="flex items-center h-8 px-3 border-b border-border/30 bg-accent/10">
						<MagnifyingGlass size={12} class="text-muted-foreground/50 shrink-0 mr-2" />
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="text"
							placeholder="Search reports..."
							bind:value={searchQuery}
						class="bg-transparent border-none outline-none text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 w-full"
						autofocus
					/>
					</div>
				{/if}

				<!-- Filter bar (only on list view) -->
				{#if view.kind === 'list'}
					<div
						class="flex items-center gap-2 h-9 px-3 border-b border-border/20 bg-background"
					>
						<!-- Category dropdown -->
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
							>
								{activeCategoryLabel}
								<CaretDown size={10} />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content
								align="start"
								sideOffset={4}
								class="z-[60] min-w-[140px]"
							>
								{#each categories as cat}
									{@const config = cat.value ? CATEGORY_CONFIG[cat.value] : null}
									<DropdownMenu.Item
										class="flex items-center gap-2 cursor-pointer"
										onSelect={() => (activeCategory = cat.value)}
									>
										{#if config}
											{@const Icon = config.icon}
											<Icon
												size={12}
												weight="fill"
												class={config.classes.split(' ').find((c) => c.startsWith('text-')) ?? ''}
											/>
										{/if}
										<span class="flex-1">{cat.label}</span>
										{#if activeCategory === cat.value}
											<Check size={12} class="text-primary" />
										{/if}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<!-- Status dropdown -->
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
							>
								{activeStatusLabel}
								<CaretDown size={10} />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content
								align="start"
								sideOffset={4}
								class="z-[60] min-w-[140px]"
							>
								{#each statuses as s}
									{@const config = s.value ? STATUS_CONFIG[s.value] : null}
									<DropdownMenu.Item
										class="flex items-center gap-2 cursor-pointer"
										onSelect={() => (activeStatus = s.value)}
									>
										{#if config}
											{@const Icon = config.icon}
											<Icon
												size={12}
												weight="fill"
												class={config.color}
											/>
										{/if}
										<span class="flex-1">{s.label}</span>
										{#if activeStatus === s.value}
											<Check size={12} class="text-primary" />
										{/if}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<div class="flex-1"></div>

						<!-- Sort dropdown -->
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
							>
								{activeSortLabel}
								<CaretDown size={10} />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content
								align="end"
								sideOffset={4}
								class="z-[60] min-w-[140px]"
							>
								{#each sorts as s}
									<DropdownMenu.Item
										class="flex items-center gap-2 cursor-pointer"
										onSelect={() => (sortOrder = s.value)}
									>
										<span class="flex-1">{s.label}</span>
										{#if sortOrder === s.value}
											<Check size={12} class="text-primary" />
										{/if}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				{/if}

				<!-- Body -->
				<div class="flex-1 min-h-0 overflow-y-auto">
					{#if view.kind === 'list'}
						<UserReportsList
							{apiClient}
							category={activeCategory}
							status={activeStatus}
							sort={sortOrder}
							search={searchQuery}
							onSelect={(id) => (view = { kind: 'detail', reportId: id })}
							onCreateNew={() => (view = { kind: 'create' })}
						/>
					{:else if view.kind === 'detail'}
						<UserReportsDetail {apiClient} reportId={view.reportId} onBack={handleBack} />
					{:else if view.kind === 'create'}
						<UserReportsCreate
							{apiClient}
							onCreated={(report) => (view = { kind: 'detail', reportId: report.id })}
							onCancel={handleBack}
						/>
					{/if}
				</div>
			</QueryClientProvider>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
