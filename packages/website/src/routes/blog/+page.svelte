<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { DiffPill } from '@acepe/ui';
	import Header from '$lib/components/header.svelte';
	import PageHero from '$lib/components/page-hero.svelte';
	import type { BlogPostMetadata } from '$lib/blog/types.js';
	import type { Component } from 'svelte';
	import {
		HardDrives,
		Eye,
		GitBranch,
		ClockCounterClockwise,
		BellRinging
	} from 'phosphor-svelte';

	let { data } = $props();

	type Post = BlogPostMetadata & { icon: Component };

	// Manual post listing (YAGNI: add auto-discovery when we have 3+ posts)
	const posts: Post[] = [
		{
			title: 'SQL Studio: Browse Databases Without Leaving Acepe',
			description:
				'Connect to Postgres, MySQL, or SQLite databases. Browse schemas, explore tables, filter and sort rows, edit cells, and run raw SQL — all inside Acepe.',
			date: '2026-02-24',
			slug: 'sql-studio',
			category: 'Features',
			characterCount: 4500,
			icon: HardDrives
		},
		{
			title: 'Git Viewer: Beautiful Inline Diffs for Commits and PRs',
			description:
				"Browse commits and pull requests with a compact file tree, syntax-highlighted diffs, and inline stats — without leaving your agent session.",
			date: '2026-02-24',
			slug: 'git-viewer',
			category: 'Features',
			characterCount: 4100,
			icon: Eye
		},
		{
			title: 'Git Panel: A Full Git Workflow Without Leaving Acepe',
			description:
				'Stage files, write commits, push and pull, browse history and stash — all from a dedicated panel inside Acepe.',
			date: '2026-02-24',
			slug: 'git-panel',
			category: 'Features',
			characterCount: 3200,
			icon: GitBranch
		},
		{
			title: 'Checkpoints: Time-Travel Debugging for AI Agents',
			description:
				"Learn how Acepe's checkpoint system creates point-in-time snapshots of file changes, letting you revert mistakes and track history with file-level granularity.",
			date: '2026-02-20',
			slug: 'checkpoints',
			category: 'Features',
			characterCount: 3500,
			icon: ClockCounterClockwise
		},
		{
			title: 'Understanding the Attention Queue',
			description:
				"Learn how Acepe's attention queue helps you manage AI agent interactions by prioritizing what needs your attention most.",
			date: '2026-02-20',
			slug: 'attention-queue',
			category: 'Product',
			characterCount: 4200,
			icon: BellRinging
		}
	];

	function formatDate(isoDate: string): string {
		const date = new Date(isoDate);
		return date.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>{m.blog_index_title()} - Acepe</title>
	<meta name="description" content={m.blog_index_subtitle()} />
	<meta property="og:title" content="{m.blog_index_title()} - Acepe" />
	<meta property="og:description" content={m.blog_index_subtitle()} />
	<meta property="og:type" content="website" />
</svelte:head>

<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

<main class="pt-20">
	<PageHero title={m.blog_index_title()} subtitle={m.blog_index_subtitle()} />

	<!-- Blog Posts -->
	<section class="px-6 pb-24 text-left">
		<div class="mx-auto max-w-6xl">
			<div class="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
			{#each posts as post}
				<article
					class="group flex flex-col rounded-xl bg-card/40 p-6 transition-all duration-200 hover:bg-card/60 md:p-8"
				>
					<!-- Title and description -->
					<a href="/blog/{post.slug}" class="block flex-1 min-h-0">
						<h2
							class="text-2xl font-bold tracking-tight md:text-3xl"
						>
							{post.title}
						</h2>
						<p class="mt-4 text-base leading-relaxed text-muted-foreground">
							{post.description}
						</p>
					</a>

					<!-- Metadata + CTA – pinned to bottom -->
					<div class="mt-auto pt-8">
						<div class="pt-6">
							<div class="flex justify-between gap-4 border-b border-border/50 py-3 text-sm">
								<span class="font-medium tracking-wider text-muted-foreground uppercase">Date</span>
								<time datetime={post.date} class="text-foreground">{formatDate(post.date)}</time>
							</div>
							{#if post.category}
								<div class="flex justify-between gap-4 border-b border-border/50 py-3 text-sm">
									<span class="font-medium tracking-wider text-muted-foreground uppercase"
										>Category</span
									>
									<div class="flex items-center gap-2">
										<post.icon size={16} weight="fill" class="text-foreground/60" />
										<span class="text-foreground">{post.category}</span>
									</div>
								</div>
							{/if}
							{#if post.characterCount !== undefined}
								<div class="flex justify-between items-center gap-4 border-b border-border/50 py-3 text-sm">
									<span class="font-medium tracking-wider text-muted-foreground uppercase"
										>Chars</span
									>
									<DiffPill
										insertions={post.characterCount}
										deletions={0}
									/>
								</div>
							{/if}
						</div>

						<!-- CTA button -->
						<div class="mt-6">
						<a
							href="/blog/{post.slug}"
							class="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
						>
							{m.blog_read_more()}
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</a>
						</div>
					</div>
				</article>
			{/each}
			</div>
		</div>
	</section>
</main>
