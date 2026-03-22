<script lang="ts">
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
	}

	let { group, header, children, style }: Props = $props();
</script>

<!--
	Card wrapper — matches the per-project card in session-list-ui.svelte:
	  flex flex-col overflow-hidden border border-border rounded-lg bg-card/50
-->
<div class="flex flex-col overflow-hidden border border-border rounded-lg bg-card/50" {style}>
	<!-- Header row -->
	{#if header}
		{@render header()}
	{:else}
		<!-- Default header — matches ProjectHeader visual -->
		<div class="shrink-0 flex items-center border-b border-border/50">
			<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
				<ProjectLetterBadge name={group.name} color={group.color ?? '#6B7280'} size={16} />
			</div>
			<div class="flex items-center flex-1 min-w-0 h-7 pl-1.5 pr-2">
				<span class="text-[11px] font-medium font-mono text-foreground truncate">{group.name}</span>
			</div>
		</div>
	{/if}

	<!-- Session list area -->
	{#if children}
		{@render children()}
	{:else}
		<!-- Default sessions — gap-0.5 p-1 matches VirtualizedSessionList wrapper -->
		<div class="flex-1 min-h-0 overflow-auto">
			<div class="flex flex-col gap-0.5 p-1">
				{#each group.sessions as session (session.id)}
					<AppSessionItem {session} />
				{/each}
			</div>
		</div>
	{/if}
</div>
