<script lang="ts">
	import * as m from "$lib/paraglide/messages.js";
	import Header from "$lib/components/header.svelte";
	import { Check, X, ArrowRight, Minus } from "@lucide/svelte";
	import type { ComparisonFeatureRow } from "$lib/compare/types.js";

	let { data } = $props();
	const comparison = $derived(data.comparison);

	const featuresByCategory = $derived.by((): ReadonlyMap<string, readonly ComparisonFeatureRow[]> => {
		const map = new Map<string, ComparisonFeatureRow[]>();
		for (const row of comparison.features) {
			const existing = map.get(row.category);
			if (existing) {
				existing.push(row);
			} else {
				map.set(row.category, [row]);
			}
		}
		return map;
	});

	let expandedFaqIndex = $state<number | null>(null);

	function toggleFaq(index: number): void {
		expandedFaqIndex = expandedFaqIndex === index ? null : index;
	}
</script>

<svelte:head>
	<title>{comparison.metaTitle}</title>
	<meta name="description" content={comparison.metaDescription} />
	<meta property="og:title" content={comparison.metaTitle} />
	<meta property="og:description" content={comparison.metaDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://acepe.dev/compare/{comparison.slug}" />
	{@html `<script type="application/ld+json">${JSON.stringify({
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: comparison.faqs.map((faq) => ({
			"@type": "Question",
			name: faq.question,
			acceptedAnswer: {
				"@type": "Answer",
				text: faq.answer,
			},
		})),
	})}</script>`}
</svelte:head>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags?.loginEnabled}
		showDownload={data.featureFlags?.downloadEnabled}
	/>

	<main class="pt-20">
		<!-- Hero -->
		<section class="flex justify-center px-4 pt-16 pb-16 md:px-6 md:pt-24 md:pb-20">
			<div class="text-center">
				<div
					class="mb-5 inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/30 px-3 py-1"
				>
					<span class="font-mono text-xs text-muted-foreground">{m.compare_badge()}</span>
				</div>
				<h1
					class="mb-4 text-3xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[56px]"
				>
					{comparison.heroTagline}
				</h1>
				<p
					class="mx-auto max-w-[700px] text-lg leading-[1.5] text-muted-foreground md:text-[22px]"
				>
					{comparison.heroDescription}
				</p>
				<div class="mt-8 flex flex-wrap items-center justify-center gap-4">
					<a
						href="/download"
						class="theme-invert-btn inline-flex h-10 items-center justify-center rounded-full px-6 text-sm font-medium transition-all duration-200"
					>
						{m.compare_cta_download()}
					</a>
					<a
						href="/pricing"
						class="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border/50 bg-card/40 px-6 text-sm font-medium text-foreground transition-colors hover:bg-card/70"
					>
						{m.compare_cta_pricing()}
						<ArrowRight class="h-3.5 w-3.5" />
					</a>
				</div>
			</div>
		</section>

		<!-- Verification -->
		<section class="mx-auto max-w-4xl px-4 pb-16 md:px-6 md:pb-20">
			<div class="rounded-2xl border border-border/50 bg-card/20 p-6 md:p-8">
				<div class="grid gap-8 md:grid-cols-[220px_1fr]">
					<div>
						<p class="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
							{m.compare_verification_title()}
						</p>
						<p class="mt-3 max-w-[260px] text-sm leading-relaxed text-muted-foreground">
							{m.compare_verification_description()}
						</p>
					</div>

					<div class="grid gap-6 md:grid-cols-[160px_1fr]">
						<div>
							<p class="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
								{m.compare_verification_last_verified()}
							</p>
							{#if comparison.lastVerifiedOn}
								<p class="mt-3 text-sm font-medium text-foreground">
									{comparison.lastVerifiedOn}
								</p>
							{/if}
						</div>

						<div>
							<p class="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
								{m.compare_verification_sources()}
							</p>
							<div class="mt-3 flex flex-col gap-3">
								{#each comparison.sourceNotes as source}
									<div class="rounded-xl border border-border/40 bg-background/40 p-4">
										<a
											href={source.url}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-muted-foreground"
										>
											<span class="break-all">{source.url}</span>
											<ArrowRight class="h-3.5 w-3.5 shrink-0" />
										</a>
										<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
											{source.note}
										</p>
									</div>
								{/each}
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- Comparison Table -->
		<section class="mx-auto max-w-4xl px-4 pb-20 md:px-6">
			<h2 class="mb-8 text-center text-2xl font-semibold tracking-tight md:text-3xl">
				{m.compare_table_title()}
			</h2>

			<div class="overflow-hidden rounded-xl border border-border/50">
				<!-- Table header -->
				<div class="grid grid-cols-[1fr_1fr_1fr] border-b border-border/50 bg-card/30">
					<div class="px-4 py-3 text-sm font-medium text-muted-foreground">
						{m.compare_table_feature()}
					</div>
					<div class="px-4 py-3 text-center text-sm font-semibold text-foreground">
						Acepe
					</div>
					<div class="px-4 py-3 text-center text-sm font-semibold text-muted-foreground">
						{comparison.competitorName}
					</div>
				</div>

				{#each featuresByCategory as [category, rows]}
					<!-- Category header -->
					<div class="border-b border-border/50 bg-muted/20 px-4 py-2">
						<span class="font-mono text-xs font-medium text-muted-foreground uppercase tracking-wider">
							{category}
						</span>
					</div>

					{#each rows as row}
						<div class="grid grid-cols-[1fr_1fr_1fr] border-b border-border/30 last:border-b-0">
							<div class="px-4 py-3 text-sm text-foreground">
								{row.feature}
							</div>
							<div class="flex items-center justify-center px-4 py-3 text-sm">
								{#if typeof row.acepe === "boolean"}
									{#if row.acepe}
										<Check class="h-4 w-4 text-emerald-500" />
									{:else}
										<Minus class="h-4 w-4 text-muted-foreground/40" />
									{/if}
								{:else}
									<span class="text-center text-muted-foreground">{row.acepe}</span>
								{/if}
							</div>
							<div class="flex items-center justify-center px-4 py-3 text-sm">
								{#if typeof row.competitor === "boolean"}
									{#if row.competitor}
										<Check class="h-4 w-4 text-emerald-500" />
									{:else}
										<Minus class="h-4 w-4 text-muted-foreground/40" />
									{/if}
								{:else}
									<span class="text-center text-muted-foreground">{row.competitor}</span>
								{/if}
							</div>
						</div>
					{/each}
				{/each}
			</div>
		</section>

		<!-- Differentiators -->
		<section class="mx-auto max-w-4xl px-4 pb-20 md:px-6">
			<h2 class="mb-10 text-center text-2xl font-semibold tracking-tight md:text-3xl">
				{m.compare_differentiators_title()}
			</h2>

			<div class="grid gap-6 md:grid-cols-3">
				{#each comparison.differentiators as diff}
					<div
						class="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/20 p-6"
					>
						<h3 class="text-lg font-semibold text-foreground">{diff.title}</h3>
						<p class="text-sm leading-relaxed text-muted-foreground">{diff.description}</p>
					</div>
				{/each}
			</div>
		</section>

		<!-- FAQ -->
		<section class="mx-auto max-w-3xl px-4 pb-20 md:px-6">
			<h2 class="mb-8 text-center text-2xl font-semibold tracking-tight md:text-3xl">
				{m.compare_faq_title()}
			</h2>

			<div class="flex flex-col gap-2">
				{#each comparison.faqs as faq, i}
					<button
						type="button"
						class="flex w-full flex-col rounded-lg border border-border/40 bg-card/20 px-5 transition-colors hover:bg-card/40"
						onclick={() => toggleFaq(i)}
					>
						<div class="flex items-center justify-between py-4">
							<span class="text-left text-sm font-medium text-foreground">{faq.question}</span>
							<span
								class="ml-4 shrink-0 text-muted-foreground transition-transform duration-200 {expandedFaqIndex === i ? 'rotate-45' : ''}"
							>
								+
							</span>
						</div>
						{#if expandedFaqIndex === i}
							<div class="pb-4 text-left text-sm leading-relaxed text-muted-foreground">
								{faq.answer}
							</div>
						{/if}
					</button>
				{/each}
			</div>
		</section>

		<!-- Final CTA -->
		<section class="flex justify-center px-4 pb-32 md:px-6">
			<div class="text-center">
				<h2 class="mb-4 text-2xl font-semibold tracking-tight md:text-3xl">
					{m.compare_cta_title()}
				</h2>
				<p class="mx-auto mb-8 max-w-[500px] text-muted-foreground">
					{m.compare_cta_description()}
				</p>
				<a
					href="/download"
					class="theme-invert-btn inline-flex h-10 items-center justify-center rounded-full px-6 text-sm font-medium transition-all duration-200"
				>
					{m.compare_cta_download()}
				</a>
			</div>
		</section>
	</main>
</div>
