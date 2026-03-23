<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { VisuallyHidden } from 'bits-ui';
	import * as DropdownMenu from '../dropdown-menu/index.js';
	import { ArrowLeft, ArrowSquareOut, CaretDown, Check, MagnifyingGlass, Plus } from 'phosphor-svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import {
		CloseAction,
		EmbeddedIconButton,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell
	} from '../panel-header/index.js';
	import type { GitHubService, IssueCategory, IssueState, View } from './types.js';
	import { CATEGORY_CONFIG, STATUS_CONFIG } from './types.js';
	import { cn } from '../../lib/utils.js';

	import UserReportsCreate from './user-reports-create.svelte';
	import UserReportsDetail from './user-reports-detail.svelte';
	import UserReportsList from './user-reports-list.svelte';

	interface Props {
		open: boolean;
		service: GitHubService;
		repoUrl?: string;
		onClose: () => void;
	}

	let { open = $bindable(), service, repoUrl = 'https://github.com/flazouh/acepe', onClose }: Props = $props();

	let view = $state<View>({ kind: 'list' });
	let searchQuery = $state('');
	let activeCategory = $state<IssueCategory | null>(null);
	let activeState = $state<IssueState | null>(null);
	let sortOrder = $state<string>('created');
	let searchOpen = $state(false);
	let listPage = $state(1);

	function resetPage() {
		listPage = 1;
	}

	const queryClient = new QueryClient({
		defaultOptions: { queries: { staleTime: 60_000 } }
	});

	const title = $derived(
		view.kind === 'create'
			? 'New Issue'
			: view.kind === 'detail'
				? 'Issue'
				: 'Issues'
	);

	const categories: { value: IssueCategory | null; label: string }[] = [
		{ value: null, label: 'All Types' },
		{ value: 'bug', label: 'Bug' },
		{ value: 'enhancement', label: 'Feature' },
		{ value: 'question', label: 'Question' },
		{ value: 'discussion', label: 'Discussion' }
	];

	const states: { value: IssueState | null; label: string }[] = [
		{ value: null, label: 'Open' },
		{ value: 'open', label: 'Open' },
		{ value: 'closed', label: 'Closed' }
	];

	const sorts: { value: string; label: string }[] = [
		{ value: 'created', label: 'Newest' },
		{ value: 'updated', label: 'Recently updated' },
		{ value: 'comments', label: 'Most discussed' }
	];

	function findLabel<T extends { value: unknown; label: string }>(items: T[], value: unknown, fallback: string): string {
		const found = items.find((item) => item.value === value);
		return found ? found.label : fallback;
	}

	const activeCategoryLabel = $derived(findLabel(categories, activeCategory, 'All Types'));
	const activeStateLabel = $derived(activeState === 'closed' ? 'Closed' : 'Open');
	const activeSortLabel = $derived(findLabel(sorts, sortOrder, 'Newest'));

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
			<VisuallyHidden>
				<Dialog.Title>GitHub Issues</Dialog.Title>
				<Dialog.Description>Browse, create, and manage GitHub issues for the Acepe repository.</Dialog.Description>
			</VisuallyHidden>
			<QueryClientProvider client={queryClient}>
				<EmbeddedPanelHeader>
					{#if view.kind !== 'list'}
						<EmbeddedIconButton title="Back" ariaLabel="Back to list" onclick={handleBack}>
							{#snippet children()}
								<ArrowLeft size={14} weight="bold" />
							{/snippet}
						</EmbeddedIconButton>
					{/if}

					<HeaderTitleCell>
						{#snippet children()}
							<span class="text-[11px] font-semibold font-mono text-foreground tracking-wide uppercase select-none">
								{title}
							</span>
						{/snippet}
					</HeaderTitleCell>

					<HeaderActionCell withDivider={false}>
						{#snippet children()}
							{#if view.kind === 'list'}
								<EmbeddedIconButton
									title="Search"
									ariaLabel="Search issues"
									active={searchOpen}
									onclick={() => {
										searchOpen = !searchOpen;
										if (!searchOpen) searchQuery = '';
										resetPage();
									}}
								>
									{#snippet children()}
										<MagnifyingGlass size={14} weight="bold" />
									{/snippet}
								</EmbeddedIconButton>

								<EmbeddedIconButton
									title="New issue"
									ariaLabel="Create new issue"
									onclick={() => (view = { kind: 'create' })}
								>
									{#snippet children()}
										<Plus size={14} weight="bold" />
									{/snippet}
								</EmbeddedIconButton>

								<EmbeddedIconButton
									title="Open on GitHub"
									ariaLabel="Open issues on GitHub"
									onclick={() => window.open(`${repoUrl}/issues`, '_blank', 'noopener,noreferrer')}
								>
									{#snippet children()}
										<ArrowSquareOut size={14} weight="bold" />
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

				{#if searchOpen && view.kind === 'list'}
					<div class="flex items-center h-8 px-3 border-b border-border/30 bg-accent/10">
						<MagnifyingGlass size={12} class="text-muted-foreground/50 shrink-0 mr-2" />
						<label for="issue-search" class="sr-only">Search issues</label>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							id="issue-search"
							type="text"
							placeholder="Search issues..."
							bind:value={searchQuery}
							oninput={resetPage}
							class="bg-transparent border-none outline-none text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 w-full"
							autofocus
						/>
					</div>
				{/if}

				{#if view.kind === 'list'}
					<div class="flex items-center gap-2 h-9 px-3 border-b border-border/20 bg-background">
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								aria-label="Filter by category"
								class="flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
							>
								{activeCategoryLabel}
								<CaretDown size={10} />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" sideOffset={4} class="z-[60] min-w-[140px]">
								{#each categories as cat}
									{@const config = cat.value ? CATEGORY_CONFIG[cat.value] : null}
									<DropdownMenu.Item class="flex items-center gap-2 cursor-pointer" onSelect={() => { activeCategory = cat.value; resetPage(); }}>
										{#if config}
											{@const Icon = config.icon}
											{@const textClass = config.classes.split(' ').find((c) => c.startsWith('text-'))}
											<Icon size={12} weight="fill" class={textClass ? textClass : ''} />
										{/if}
										<span class="flex-1">{cat.label}</span>
										{#if activeCategory === cat.value}
											<Check size={12} class="text-primary" />
										{/if}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								aria-label="Filter by status"
								class="flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
							>
								{activeStateLabel}
								<CaretDown size={10} />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" sideOffset={4} class="z-[60] min-w-[140px]">
								{#each states as s}
									{@const config = s.value ? STATUS_CONFIG[s.value] : null}
									<DropdownMenu.Item class="flex items-center gap-2 cursor-pointer" onSelect={() => { activeState = s.value; resetPage(); }}>
										{#if config}
											{@const Icon = config.icon}
											<Icon size={12} weight="fill" class={config.color} />
										{/if}
										<span class="flex-1">{s.label}</span>
										{#if activeState === s.value}
											<Check size={12} class="text-primary" />
										{/if}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<div class="flex-1"></div>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								aria-label="Sort order"
								class="flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
							>
								{activeSortLabel}
								<CaretDown size={10} />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" sideOffset={4} class="z-[60] min-w-[140px]">
								{#each sorts as s}
									<DropdownMenu.Item class="flex items-center gap-2 cursor-pointer" onSelect={() => { sortOrder = s.value; resetPage(); }}>
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

				<div class="flex-1 min-h-0 overflow-y-auto">
					{#if view.kind === 'list'}
						<UserReportsList
							{service}
							category={activeCategory}
							state={activeState ? activeState : 'open'}
							sort={sortOrder}
							search={searchQuery}
							page={listPage}
							onSelect={(num) => (view = { kind: 'detail', issueNumber: num })}
							onPageChange={(p) => (listPage = p)}
							onCreateNew={() => (view = { kind: 'create' })}
						/>
					{:else if view.kind === 'detail'}
						<UserReportsDetail {service} issueNumber={view.issueNumber} onBack={handleBack} />
					{:else if view.kind === 'create'}
						<UserReportsCreate
							{service}
							onCreated={(issue) => (view = { kind: 'detail', issueNumber: issue.number })}
							onCancel={handleBack}
						/>
					{/if}
				</div>
			</QueryClientProvider>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
