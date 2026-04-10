<script lang="ts">
import * as m from "$lib/paraglide/messages.js";
import { DiffPill } from "@acepe/ui";
import Header from "$lib/components/header.svelte";
import type { BlogPostMetadata } from "$lib/blog/types.js";
import { getAllBlogPosts } from "$lib/blog/posts.js";
import type { Component } from "svelte";
import { ArrowRight } from "@lucide/svelte";
import { HardDrives, Eye, GitBranch, ClockCounterClockwise, BellRinging } from "phosphor-svelte";

let { data } = $props();

type Post = BlogPostMetadata & { icon: Component };

const postIcons = new Map<string, Component>([
	["sql-studio", HardDrives],
	["git-viewer", Eye],
	["git-panel", GitBranch],
	["checkpoints", ClockCounterClockwise],
	["attention-queue", BellRinging],
]);

const posts: Post[] = getAllBlogPosts().map((post) => ({
	title: post.title,
	description: post.description,
	date: post.date,
	slug: post.slug,
	category: post.category,
	characterCount: post.characterCount,
	readingTimeMinutes: post.readingTimeMinutes,
	relatedLinks: post.relatedLinks,
	icon: postIcons.get(post.slug) ?? BellRinging,
}));

function formatDate(isoDate: string): string {
	const date = new Date(isoDate);
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
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

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main class="pt-20">
		<!-- Hero -->
		<section class="flex justify-center px-4 pt-16 pb-16 md:px-6 md:pt-24 md:pb-20">
			<div class="text-center">
				<h1
					class="mb-4 text-3xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[56px]"
				>
					{m.blog_index_title()}
				</h1>
				<p
					class="mx-auto max-w-[600px] text-lg leading-[1.5] text-muted-foreground md:text-[22px]"
				>
					{m.blog_index_subtitle()}
				</p>
			</div>
		</section>

		<!-- Blog Posts -->
		<section class="mx-auto max-w-6xl px-4 pb-32 md:px-6">
			<div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
				{#each posts as post}
					<article
						class="blog-card group flex flex-col overflow-hidden rounded-xl border border-border/50 bg-card/20 transition-colors hover:bg-card/40"
					>
						<!-- Panel Header -->
						<div
							class="flex h-9 items-center justify-between border-b border-border/50 px-3"
						>
							<div class="flex items-center gap-2">
								<post.icon size={14} weight="fill" class="text-muted-foreground/60" />
								<span class="font-mono text-xs font-semibold text-foreground"
									>{post.category}</span
								>
							</div>
							<span class="font-mono text-[10px] text-muted-foreground/60"
								>{formatDate(post.date)}</span
							>
						</div>

						<!-- Body -->
						<div class="flex flex-1 flex-col p-5">
							<a href="/blog/{post.slug}" class="block flex-1">
								<h2 class="mb-2 text-base font-semibold leading-snug text-foreground">
									{post.title}
								</h2>
								<p class="text-[13px] leading-relaxed text-muted-foreground">
									{post.description}
								</p>
							</a>

							<!-- Metadata -->
							<div class="mt-6 flex flex-col gap-0">
								{#if post.characterCount !== undefined}
									<div
										class="flex items-center justify-between border-t border-border/30 py-2 font-mono text-xs"
									>
										<span class="text-muted-foreground/60">chars</span>
										<DiffPill insertions={post.characterCount} deletions={0} />
									</div>
								{/if}
							</div>

							<!-- CTA -->
							<a
								href="/blog/{post.slug}"
								class="mt-4 flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
							>
								{m.blog_read_more()}
								<ArrowRight class="h-3.5 w-3.5" />
							</a>
						</div>
					</article>
				{/each}
			</div>
		</section>
	</main>

	<!-- Footer -->
	<footer class="border-t border-border/50 px-4 py-12 md:px-6">
		<div class="mx-auto flex max-w-6xl justify-center">
			<a
				href="https://startupfa.me/s/acepe?utm_source=acepe.dev"
				target="_blank"
				rel="noopener"
			>
				<img
					src="https://startupfa.me/badges/featured-badge-small.webp"
					alt="Acepe - Featured on Startup Fame"
					width="224"
					height="36"
				/>
			</a>
		</div>
	</footer>
</div>

<style>
	.blog-card {
		backdrop-filter: blur(12px);
	}
</style>
