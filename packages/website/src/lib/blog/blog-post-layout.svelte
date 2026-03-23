<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import Header from '$lib/components/header.svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import type { BlogPostMetadata } from './types.js';
	import type { Snippet } from 'svelte';

	interface Props {
		metadata: BlogPostMetadata;
		children: Snippet;
		showDownload?: boolean;
		showLogin?: boolean;
	}

	let { metadata, children, showDownload = false, showLogin = false }: Props = $props();

	function formatDate(isoDate: string): string {
		const date = new Date(isoDate);
		return date.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	// Create JSON-LD structured data for BlogPosting (reactive to metadata)
	const jsonLd = $derived({
		'@context': 'https://schema.org',
		'@type': 'BlogPosting',
		headline: metadata.title,
		description: metadata.description,
		datePublished: metadata.date,
		author: {
			'@type': 'Organization',
			name: metadata.author || 'Acepe'
		},
		publisher: {
			'@type': 'Organization',
			name: 'Acepe'
		}
	});
</script>

<svelte:head>
	<title>{metadata.title} - Acepe Blog</title>
	<meta name="description" content={metadata.description} />
	<meta property="og:title" content={metadata.title} />
	<meta property="og:description" content={metadata.description} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content="https://acepe.dev/blog/{metadata.slug}" />
	{#if metadata.ogImage}
		<meta property="og:image" content={metadata.ogImage} />
	{/if}
	<meta property="article:published_time" content={metadata.date} />
	{@html `<script type="application/ld+json">${JSON.stringify(jsonLd)}<\/script>`}
</svelte:head>

<Header {showDownload} {showLogin} />

<main class="pt-20">
	<article class="mx-auto max-w-5xl px-4 py-16 md:px-6">
		<!-- Back to Blog Link -->
		<div class="mb-8">
			<a
				href="/blog"
				class="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ArrowLeft class="h-3.5 w-3.5" />
				<span>{m.blog_back_to_index()}</span>
			</a>
		</div>

		<!-- Post Header Panel -->
		<div
			class="mb-12 overflow-hidden rounded-xl border border-border/50 bg-card/20"
			style="backdrop-filter: blur(12px);"
		>
			<div class="flex h-9 items-center justify-between border-b border-border/50 px-3">
				<span class="font-mono text-xs font-semibold text-foreground"
					>{metadata.category || 'Blog'}</span
				>
				<span class="font-mono text-[10px] text-muted-foreground/60"
					>{formatDate(metadata.date)}</span
				>
			</div>
			<div class="p-6 md:p-8">
				<h1 class="text-3xl font-bold tracking-tight sm:text-4xl">
					{metadata.title}
				</h1>
				<p class="mt-3 text-[15px] leading-relaxed text-muted-foreground">
					{metadata.description}
				</p>
			</div>
		</div>

		<!-- Post Content -->
		<div class="blog-content space-y-8">
			{@render children()}
		</div>
	</article>
</main>

<style>
	.blog-content :global(.markdown-content) {
		max-width: none;
	}

	.blog-content :global(h2) {
		font-size: 2rem;
		font-weight: 700;
		margin-top: 3rem;
		margin-bottom: 1.5rem;
		line-height: 1.3;
	}

	.blog-content :global(h3) {
		font-size: 1.5rem;
		font-weight: 600;
		margin-top: 2rem;
		margin-bottom: 1rem;
		line-height: 1.4;
	}

	.blog-content :global(p) {
		margin-bottom: 1.5rem;
		line-height: 1.75;
	}
</style>
