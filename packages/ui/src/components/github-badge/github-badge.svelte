<script lang="ts">
	/**
	 * GitHubBadge — Presentational GitHub reference badge.
	 * No Tauri coupling, no diff fetching — props in, callbacks out.
	 *
	 * Renders as:
	 * - <a>      when href is provided (website / non-interactive link)
	 * - <button> when onclick is provided (desktop diff viewer)
	 * - <span>   otherwise
	 */
	import type { Snippet } from 'svelte';
	import { GitCommit, GitMerge, GitPullRequest } from 'phosphor-svelte';

	import { ChipShell } from '../chip/index.js';
	import { DiffPill } from '../diff-pill/index.js';
	import { Colors } from '../../lib/colors.js';
	import { getGitHubLabel, type GitHubReference } from '../../lib/markdown/github-badge.js';

	interface Props {
		ref: GitHubReference;
		prState?: "open" | "closed" | "merged";
		insertions?: number;
		deletions?: number;
		/** Show a loading skeleton for diff stats */
		loading?: boolean;
		/** Renders badge as an anchor link. Takes priority over onclick. */
		href?: string;
		/** Renders badge as a button with this click handler. */
		onclick?: (e: MouseEvent) => void;
		/** Trailing content slot — for desktop's CopyButton etc. */
		children?: Snippet;
		class?: string;
	}

	let {
		ref,
		prState,
		insertions = 0,
		deletions = 0,
		loading = false,
		href,
		onclick,
		children,
		class: className = ''
	}: Props = $props();

	const label = $derived(getGitHubLabel(ref));
	const iconColor = $derived(
		ref.type === "commit"
		? "var(--foreground)"
			: prState === "merged"
				? Colors.purple
				: prState === "closed"
					? Colors.red
					: Colors.green
	);
	const showDiff = $derived(insertions > 0 || deletions > 0);
	const chipClassName = $derived(className ? `github-badge ${className}` : 'github-badge');
</script>

{#snippet content()}
	<span
		class="h-3.5 w-3.5 shrink-0 flex items-center justify-center"
		style="color: {iconColor}"
		aria-hidden="true"
	>
		{#if ref.type === 'commit'}
			<GitCommit weight="bold" size={14} />
		{:else if prState === 'merged'}
			<GitMerge weight="bold" size={14} />
		{:else}
			<GitPullRequest weight="bold" size={14} />
		{/if}
	</span>
	<span class="min-w-0 truncate font-mono text-[0.6875rem] leading-none">{label}</span>
	{#if loading}
		<span class="ml-0.5 inline-flex items-center">
			<span class="inline-block h-3 w-10 animate-pulse rounded bg-muted-foreground/15"></span>
		</span>
	{:else if showDiff}
		<span class="ml-0.5 inline-flex items-center">
			<DiffPill {insertions} {deletions} variant="plain" />
		</span>
	{/if}
	{@render children?.()}
{/snippet}

{#if href}
	<ChipShell
		as="a"
		{href}
		target="_blank"
		rel="noopener noreferrer"
		class={chipClassName}
		title={label}
	>
		{@render content()}
	</ChipShell>
{:else if onclick}
	<ChipShell
		as="button"
		class={chipClassName}
		title={label}
		{onclick}
	>
		{@render content()}
	</ChipShell>
{:else}
	<ChipShell class={chipClassName} title={label}>
		{@render content()}
	</ChipShell>
{/if}
