<script lang="ts">
import Header from "$lib/components/header.svelte";
import { ArrowRight } from "@lucide/svelte";
import { getAllComparisonSlugs, getComparison } from "$lib/compare/data.js";

let { data } = $props();

const comparisons = $derived(
	getAllComparisonSlugs()
		.map((slug) => getComparison(slug))
		.filter((c): c is NonNullable<typeof c> => c !== null)
);
</script>

<svelte:head>
	<title>{"Compare Acepe"} - Acepe</title>
	<meta name="description" content={"See how Acepe stacks up against other developer tools, feature by feature."} />
	<meta property="og:title" content="{"Compare Acepe"} - Acepe" />
	<meta property="og:description" content={"See how Acepe stacks up against other developer tools, feature by feature."} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://acepe.dev/compare" />
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
					<span class="font-mono text-xs text-muted-foreground">{"comparison"}</span>
				</div>
				<h1
					class="mb-4 text-3xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[56px]"
				>
					{"Compare Acepe"}
				</h1>
				<p
					class="mx-auto max-w-[600px] text-lg leading-[1.5] text-muted-foreground md:text-[22px]"
				>
					{"See how Acepe stacks up against other developer tools, feature by feature."}
				</p>
			</div>
		</section>

		<!-- Comparison Cards -->
		<section class="mx-auto max-w-3xl px-4 pb-32 md:px-6">
			<div class="grid gap-4">
				{#each comparisons as comparison}
					<a
						href="/compare/{comparison.slug}"
						class="group flex items-center justify-between rounded-xl border border-border/50 bg-card/20 p-6 transition-colors hover:bg-card/40"
					>
						<div class="min-w-0">
							<h2 class="mb-1 text-lg font-semibold text-foreground">
								{comparison.heroTagline}
							</h2>
							<p class="text-sm text-muted-foreground line-clamp-2">
								{comparison.heroDescription}
							</p>
						</div>
						<ArrowRight class="ml-4 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
					</a>
				{/each}
			</div>
		</section>
	</main>
</div>
