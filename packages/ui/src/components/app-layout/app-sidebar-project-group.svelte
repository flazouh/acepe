<script lang="ts">
	import { CaretDown } from 'phosphor-svelte';
	import { DotsThreeVertical } from 'phosphor-svelte';
	import { Plus } from 'phosphor-svelte';
	import type { Snippet } from 'svelte';

	import { ProjectLetterBadge } from '../project-letter-badge/index.js';
	import AppSessionItem from './app-session-item.svelte';
	import type { AppProjectGroup } from './types.js';

	interface Props {
		group: AppProjectGroup;
		/** Override the header row (desktop passes ProjectHeader + settings menu) */
		header?: Snippet;
		/** Override the session list area (desktop passes VirtualizedSessionList) */
		children?: Snippet;
		/** Inline style for the card root (desktop uses this for flex sizing) */
		style?: string;
		/** Show the "+" new session button in the header */
		showCreateButton?: boolean;
		/** Show the overflow "..." menu button in the header */
		showOverflowMenu?: boolean;
		/** Whether the project card is expanded (controls chevron rotation) */
		expanded?: boolean;
	}

	let {
		group,
		header,
		children,
		style,
		showCreateButton = true,
		showOverflowMenu = true,
		expanded = true,
	}: Props = $props();
</script>

<!--
	Card wrapper — matches the per-project card in session-list-ui.svelte:
	  flex flex-col overflow-hidden rounded-md bg-card/75
-->
<div class="flex flex-col overflow-hidden rounded-md bg-card/75" {style}>
	<!-- Header row -->
	{#if header}
		{@render header()}
	{:else}
		<!-- Default header — matches desktop ProjectHeader -->
		<div class="shrink-0 flex items-center group min-w-0">
			<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
				<ProjectLetterBadge
					name={group.name}
					color={group.color ?? '#6B7280'}
					iconSrc={group.iconSrc ?? null}
					size={16}
				/>
			</div>
			<div class="flex items-center flex-1 min-w-0 h-7 pl-2 pr-2 cursor-pointer rounded-md transition-colors">
				<span class="truncate text-[10px] font-semibold tracking-wide text-muted-foreground/70">
					{group.name}
				</span>
			</div>
			<button
				type="button"
				class="flex items-center justify-center size-5 shrink-0 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				aria-label={expanded ? "Collapse project" : "Expand project"}
			>
				<CaretDown
					class="h-3 w-3 transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
					weight="bold"
				/>
			</button>
			{#if showOverflowMenu}
				<button
					type="button"
					class="flex items-center justify-center size-5 shrink-0 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					aria-label="Project settings"
				>
					<DotsThreeVertical class="h-3.5 w-3.5" weight="bold" />
				</button>
			{/if}
			{#if showCreateButton}
				<div class="flex items-center pr-1">
					<button
						type="button"
						class="flex items-center justify-center size-5 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						aria-label="New session in {group.name}"
					>
						<Plus class="h-3 w-3" />
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Session list area -->
	{#if children}
		{@render children()}
	{:else if expanded}
		<!-- Sessions — gap-0.5 p-1 matches VirtualizedSessionList wrapper -->
		<div class="flex-1 min-h-0 max-h-[22rem] overflow-y-auto overflow-x-hidden px-0.5 pb-0.5">
			<div class="flex flex-col gap-0.5 px-0.5 pb-0.5">
				{#each group.sessions as session (session.id)}
					<AppSessionItem {session} />
				{/each}
			</div>
		</div>
	{/if}
</div>
