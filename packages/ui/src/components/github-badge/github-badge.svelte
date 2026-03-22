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
			? Colors.orange
			: prState === "merged"
				? Colors.purple
				: prState === "closed"
					? Colors.red
					: Colors.green
	);
	const showDiff = $derived(insertions > 0 || deletions > 0);

	const baseClass =
		'github-badge inline-flex min-w-0 items-center gap-1.5 rounded-sm bg-muted px-1 py-0.5 ' +
		'text-muted-foreground';
	const interactiveClass =
		'hover:bg-accent hover:text-accent-foreground active:opacity-80 ' +
		'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 cursor-pointer';
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
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		class="{baseClass} {interactiveClass} no-underline text-xs {className}"
		title={label}
	>
		{@render content()}
	</a>
{:else if onclick}
	<button
		type="button"
		class="{baseClass} {interactiveClass} border-none text-xs {className}"
		title={label}
		{onclick}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				onclick(e as unknown as MouseEvent);
			}
		}}
	>
		{@render content()}
	</button>
{:else}
	<span class="{baseClass} text-xs {className}" title={label}>
		{@render content()}
	</span>
{/if}
