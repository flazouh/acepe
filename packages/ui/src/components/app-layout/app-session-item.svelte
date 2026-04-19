<script lang="ts">
	import { GitMerge, GitPullRequest, Tree } from 'phosphor-svelte';

	import { DiffPill } from '../diff-pill/index.js';
	import { ProjectLetterBadge } from '../project-letter-badge/index.js';
	import { resolveAppSessionItemVisualState } from './app-session-item-visual-state.js';
	import type { AppSessionItem, AppSessionPrState } from './types.js';

	interface Props {
		session: AppSessionItem;
		onSelect?: (session: AppSessionItem) => void;
	}

	let { session, onSelect }: Props = $props();

	const visual = $derived(resolveAppSessionItemVisualState(session));

	function prColor(state: AppSessionPrState): string {
		if (state === 'MERGED') return 'var(--purple, #a855f7)';
		if (state === 'CLOSED') return 'var(--destructive)';
		return 'var(--success)';
	}

	function handleClick() {
		onSelect?.(session);
	}
</script>

<!--
	Mirrors the desktop session row (session-item.svelte → ActivityEntry) at the
	sidebar-compact density. All new fields are optional so existing callers that
	only pass { id, title, status, isActive } keep their current visual.
	  px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors
	  icon: w-3 h-3 (12px) m-0.5
	  title: text-xs font-medium truncate
-->
<button
	type="button"
	data-testid="app-session-item"
	data-session-id={session.id}
	data-active={visual.isActive ? 'true' : 'false'}
	onclick={handleClick}
	class="flex flex-col justify-center w-full text-left gap-0.5 px-2 py-1.5 rounded-md transition-colors hover:bg-accent/50 {visual.isActive
		? 'bg-accent/20'
		: ''}"
>
	<div class="flex items-center gap-1.5 min-w-0">
		{#if visual.showAgentIcon && session.agentIconSrc}
			<img
				src={session.agentIconSrc}
				alt=""
				class="w-3 h-3 shrink-0 m-0.5"
				role="presentation"
				width="12"
				height="12"
			/>
		{/if}

		{#if visual.showProjectBadge && session.projectName && session.projectColor}
			<ProjectLetterBadge
				name={session.projectName}
				color={session.projectColor}
				iconSrc={session.projectIconSrc ?? null}
				size={12}
				sequenceId={session.sequenceId}
				showLetter={false}
				class="font-mono shrink-0"
			/>
		{/if}

		{#if visual.showWorktreeIcon}
			<Tree
				size={12}
				weight="fill"
				class="shrink-0 m-0.5 {visual.isWorktreeDeleted ? 'text-destructive' : 'text-success'}"
				color="currentColor"
				aria-label={visual.isWorktreeDeleted ? 'Worktree deleted' : 'Worktree session'}
				data-testid="app-session-item-worktree-icon"
			/>
		{/if}

		{#if visual.showPrBadge && session.prNumber != null && visual.prState}
			<span
				class="inline-flex items-center gap-0.5 shrink-0 rounded-sm px-0.5 py-0.5"
				data-testid="app-session-item-pr-badge"
				title={`PR #${session.prNumber}`}
			>
				{#if visual.prState === 'MERGED'}
					<GitMerge size={11} weight="fill" style="color: {prColor('MERGED')}" />
				{:else}
					<GitPullRequest
						size={11}
						weight="fill"
						style="color: {prColor(visual.prState)}"
					/>
				{/if}
				<span class="text-[10px] font-mono leading-none text-muted-foreground">
					#{session.prNumber}
				</span>
			</span>
		{/if}

		<div class="flex-1 min-w-0">
			<div class="text-xs font-medium truncate">{session.title}</div>
		</div>

		{#if visual.showTimeAgo}
			<span
				class="text-[10px] font-mono leading-none text-muted-foreground shrink-0"
				data-testid="app-session-item-time-ago"
			>
				{session.timeAgo}
			</span>
		{/if}

		{#if visual.showDiffPill}
			<DiffPill
				insertions={session.insertions ?? 0}
				deletions={session.deletions ?? 0}
				variant="plain"
				class="shrink-0"
			/>
		{/if}

		{#if visual.showStreamingDot}
			<span
				class="relative flex h-1.5 w-1.5 shrink-0"
				data-testid="app-session-item-streaming-dot"
			>
				<span
					class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"
				></span>
				<span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
			</span>
		{:else if visual.statusDotKind === 'done'}
			<span
				class="h-1.5 w-1.5 rounded-full shrink-0 bg-green-500"
				data-testid="app-session-item-status-dot"
				data-status="done"
			></span>
		{:else if visual.statusDotKind === 'error'}
			<span
				class="h-1.5 w-1.5 rounded-full shrink-0 bg-destructive"
				data-testid="app-session-item-status-dot"
				data-status="error"
			></span>
		{:else if visual.statusDotKind === 'unseen'}
			<span
				class="h-1.5 w-1.5 rounded-full shrink-0 bg-yellow-500"
				data-testid="app-session-item-status-dot"
				data-status="unseen"
			></span>
		{/if}
	</div>

	{#if visual.showLastAction}
		<div
			class="text-[10px] text-muted-foreground truncate pl-[18px]"
			data-testid="app-session-item-last-action"
		>
			{session.lastActionText}
		</div>
	{/if}
</button>
