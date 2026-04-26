<script lang="ts">
import { ArrowRightIcon, PillButton, BrandLockup } from "@acepe/ui";
import Header from "$lib/components/header.svelte";
import ZeusShaderStage from "$lib/components/zeus-shader-stage.svelte";
import { GithubLogo } from "phosphor-svelte";

let { data } = $props();

const principles = [
	{
		index: "01",
		title: "Watches every agent.",
		body: "Zeus reads the live state of every session — every plan, every tool call, every diff. No prompting. No manual triage.",
	},
	{
		index: "02",
		title: "Routes to the right specialist.",
		body: "Claude Code, Codex, Cursor, OpenCode. Zeus picks the agent best suited to the work, and steps in only when the work needs a hand.",
	},
	{
		index: "03",
		title: "Holds the engineering line.",
		body: "Tests must pass. PRs must be reviewable. Checkpoints must be intact. Zeus refuses to ship work that breaks the rules you set.",
	},
	{
		index: "04",
		title: "Ships from plan to PR.",
		body: "From the first scoped requirement to the merged pull request — Zeus runs the workflow so you review finished work, not in‑flight chaos.",
	},
];

const meta = [
	{ k: "Layer", v: "Orchestration" },
	{ k: "Inputs", v: "Sessions, repo, plan" },
	{ k: "Output", v: "Shipped pull requests" },
	{ k: "Status", v: "Coming soon" },
];
</script>

<svelte:head>
	<title>Zeus — The conductor for your agents · Acepe</title>
	<meta
		name="description"
		content="Zeus is the orchestration layer above every coding agent. It watches, routes, and ships — so you stay in command of the work, not the tools. Coming soon to Acepe."
	/>
</svelte:head>

<div class="zeus-page">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main>
		<!-- HERO — typographic monolith -->
		<section class="zeus-hero relative isolate overflow-hidden">
			<div class="absolute inset-0 -z-10">
				<ZeusShaderStage heightClass="h-full" />
			</div>

			<div class="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-6 pt-32 pb-16 md:px-10 md:pt-36 md:pb-20">
				<!-- Top rail -->
				<div class="flex items-center justify-end gap-4">
					<span class="hidden font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground/60 md:inline-block">
						mmxxvi
					</span>
				</div>

				<!-- Wordmark — logo and name are intentionally separated -->
				<div class="zeus-monolith mt-20 flex flex-col md:mt-24">
					<div class="zeus-mark-lockup">
						<h1 class="zeus-wordmark leading-[0.82] font-semibold tracking-[-0.06em] text-foreground">
							ZEUS
						</h1>
					</div>

					<!-- Tagline + CTA row, anchored to the wordmark baseline -->
					<div class="zeus-tagline-row mt-10 flex flex-col items-start justify-between gap-8 md:mt-14 md:flex-row md:items-end md:gap-12">
						<p class="zeus-tagline max-w-[34ch] text-pretty font-medium tracking-[-0.015em] text-foreground">
							The conductor for your coding agents.
						</p>
						<div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
							<PillButton
								href="#early-access"
								variant="invert"
								size="default"
								class="h-12 py-1.5 pr-1.5 pl-6"
							>
								Get early access
								{#snippet trailingIcon()}
									<ArrowRightIcon size="lg" />
								{/snippet}
							</PillButton>
							<a
								href="/"
								class="inline-flex h-12 items-center gap-2 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
							>
								<span class="border-b border-border/60 pb-0.5">Back to Acepe</span>
								<ArrowRightIcon size="sm" />
							</a>
						</div>
					</div>
				</div>

				<!-- Bottom hairline meta strip — no card, just rule + columns -->
				<div class="zeus-meta-strip mt-16 grid grid-cols-2 gap-y-4 border-t border-border/40 pt-6 md:mt-20 md:grid-cols-4 md:gap-x-10 md:pt-8">
					{#each meta as m}
						<div class="flex flex-col gap-1 text-left">
							<span class="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60">
								{m.k}
							</span>
							<span class="text-[13px] font-medium text-foreground md:text-sm">
								{m.v}
							</span>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- MANIFESTO — single oversized statement, narrow column -->
		<section class="zeus-section zeus-section--manifesto relative px-6 md:px-10">
			<div class="mx-auto max-w-3xl">
				<p class="zeus-manifesto text-pretty font-medium tracking-[-0.022em] text-foreground">
					An ADE made agents addressable.
					<br class="hidden md:inline" />
					<span class="text-success">Zeus makes them accountable.</span>
				</p>
				<p class="zeus-body mt-8 max-w-[58ch] text-muted-foreground">
					Most agent tools optimize for the next prompt. Zeus optimizes for the next ship — by sitting above your sessions, holding the plan, and refusing to let work drift past the engineering bar you set.
				</p>
			</div>
		</section>

		<!-- PRINCIPLES — editorial numbered list, no cards -->
		<section class="zeus-section zeus-section--principles relative px-6 md:px-10">
			<div class="mx-auto max-w-5xl">
				<div class="zeus-principles-head mb-14 flex flex-col gap-3 md:mb-20 md:flex-row md:items-end md:justify-between md:gap-12">
					<h2 class="zeus-h2 text-balance font-semibold tracking-[-0.035em] text-foreground">
						What Zeus<br class="hidden md:inline" /> actually does.
					</h2>
					<span class="font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground/60">
						Four behaviors · one mind
					</span>
				</div>

				<ol class="zeus-principles flex flex-col">
					{#each principles as p}
						<li class="zeus-principle group border-t border-border/40">
							<span class="zeus-principle-index font-mono uppercase tracking-[0.32em] text-muted-foreground/70 transition-colors duration-300 group-hover:text-success">
								{p.index}
							</span>
							<h3 class="zeus-principle-title zeus-h3 text-balance font-medium tracking-[-0.018em] text-foreground">
								{p.title}
							</h3>
							<p class="zeus-principle-body zeus-body-sm text-muted-foreground">
								{p.body}
							</p>
						</li>
					{/each}
					<li class="border-t border-border/40"></li>
				</ol>
			</div>
		</section>

		<!-- PROMISE — two-column editorial -->
		<section class="zeus-section zeus-section--promise relative px-6 md:px-10">
			<div class="zeus-promise-grid mx-auto max-w-5xl">
				<div>
					<span class="mb-5 inline-block font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground/60">
						The promise
					</span>
					<h2 class="zeus-h2 text-balance font-semibold tracking-[-0.035em] text-foreground">
						Quietly in command.
					</h2>
				</div>
				<div class="flex flex-col gap-5">
					<p class="zeus-body text-muted-foreground">
						Zeus does not chat. It does not hallucinate intentions. It reads the work that is actually being done — every plan, every tool call, every diff — and steers it toward the outcome you defined.
					</p>
					<p class="zeus-body text-muted-foreground">
						Where other systems leave you babysitting agents, Zeus leaves you reviewing finished work. The decisions that matter still go through you. The work that doesn't, never reaches your desk.
					</p>
				</div>
			</div>
		</section>

		<!-- EARLY ACCESS — same monolith treatment, smaller -->
		<section
			id="early-access"
			class="zeus-section zeus-cta relative isolate overflow-hidden px-6 md:px-10"
		>
			<div class="absolute inset-0 -z-10">
				<ZeusShaderStage heightClass="h-full" />
			</div>
			<div class="relative mx-auto flex max-w-3xl flex-col items-start text-left">
				<span class="mb-5 font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground/80">
					Early access
				</span>
				<h2 class="zeus-h1 text-balance font-semibold tracking-[-0.04em] text-foreground">
					Be among the first to meet Zeus.
				</h2>
				<p class="zeus-body mt-6 max-w-[52ch] text-pretty text-muted-foreground">
					Early access opens for Acepe users first. Download the app today and you'll be at the front of the line.
				</p>
				<div class="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
					<PillButton
						href="/download"
						variant="invert"
						size="default"
						class="h-12 py-1.5 pr-1.5 pl-6 shadow-[0_18px_50px_-18px_rgba(91,168,154,0.45)]"
					>
						Download Acepe
						{#snippet trailingIcon()}
							<ArrowRightIcon size="lg" />
						{/snippet}
					</PillButton>
					<a
						href="https://github.com/flazouh/acepe"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex h-12 items-center gap-2 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						<GithubLogo size={16} weight="fill" />
						<span class="border-b border-border/60 pb-0.5">Star on GitHub</span>
					</a>
				</div>
			</div>
		</section>
	</main>

	<!-- Footer -->
	<footer class="border-t border-border/50 px-4 py-12 md:px-6">
		<div class="mx-auto max-w-6xl">
			<div class="grid grid-cols-2 gap-8 md:grid-cols-4">
				<div class="col-span-2 md:col-span-1">
					<a href="/" class="mb-3 inline-flex items-center gap-2">
						<BrandLockup class="gap-2" markClass="h-6 w-6" wordmarkClass="text-sm" />
					</a>
					<p class="max-w-[220px] text-[13px] leading-relaxed text-muted-foreground">
						The orchestration layer for your agents.
					</p>
				</div>

				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						Product
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a href="/blog" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								Blog
							</a>
						</li>
						<li>
							<a href="/changelog" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								Changelog
							</a>
						</li>
						<li>
							<a href="/pricing" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								Pricing
							</a>
						</li>
						<li>
							<a href="/compare" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								Compare
							</a>
						</li>
						{#if data.featureFlags?.roadmapEnabled}
							<li>
								<a href="/roadmap" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
									Roadmap
								</a>
							</li>
						{/if}
					</ul>
				</div>

				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						Resources
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a
								href="https://github.com/flazouh/acepe"
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
							>
								<GithubLogo size={14} weight="fill" />
								GitHub
							</a>
						</li>
					</ul>
				</div>

				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						Legal
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a href="/privacy" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								Privacy
							</a>
						</li>
						<li>
							<a href="/terms" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								Terms
							</a>
						</li>
					</ul>
				</div>
			</div>

			<div class="mt-10 border-t border-border/30 pt-6">
				<span class="font-mono text-[11px] text-muted-foreground/50">
					{`© ${new Date().getFullYear().toString()} Acepe. All rights reserved.`}
				</span>
			</div>
		</div>
	</footer>
</div>

<style>
	.zeus-page {
		background-color: var(--background);
		min-height: 100vh;
		overflow-x: hidden;
	}

	/* Every section clears the floating header on anchor jumps */
	.zeus-section {
		scroll-margin-top: 96px;
	}

	/* Section vertical rhythm — calm, generous, but not airy */
	.zeus-section--manifesto {
		padding-top: clamp(96px, 14vh, 200px);
		padding-bottom: clamp(96px, 14vh, 200px);
	}
	.zeus-section--principles {
		padding-top: clamp(80px, 12vh, 160px);
		padding-bottom: clamp(96px, 14vh, 180px);
	}
	.zeus-section--promise {
		--zeus-promise-space-y: clamp(112px, 16vh, 220px);
		padding-top: var(--zeus-promise-space-y);
		padding-bottom: var(--zeus-promise-space-y);
	}
	.zeus-cta {
		padding-top: clamp(112px, 16vh, 220px);
		padding-bottom: clamp(112px, 16vh, 220px);
	}

	/* Display typography — written in CSS to bypass JIT cache quirks */
	.zeus-h1 {
		font-size: clamp(2.5rem, 7.4vw, 6rem);
		line-height: 1.04;
	}

	.zeus-h2 {
		font-size: clamp(2rem, 5vw, 3.5rem);
		line-height: 1.1;
	}

	.zeus-h3 {
		font-size: clamp(1.375rem, 2.4vw, 1.875rem);
		line-height: 1.2;
	}

	.zeus-tagline {
		font-size: clamp(1.125rem, 1.8vw, 1.625rem);
		line-height: 1.25;
	}

	.zeus-manifesto {
		font-size: clamp(1.5rem, 3.2vw, 2.625rem);
		line-height: 1.18;
	}

	.zeus-body {
		font-size: clamp(0.9375rem, 1.05vw, 1.0625rem);
		line-height: 1.7;
	}

	.zeus-body-sm {
		font-size: clamp(0.875rem, 0.95vw, 0.9375rem);
		line-height: 1.7;
	}

	/* Hero monolith composition */
	.zeus-hero {
		min-height: 100vh;
	}

	.zeus-monolith {
		padding-top: clamp(40px, 7vh, 100px);
	}

	.zeus-mark-lockup {
		display: flex;
		align-items: baseline;
		justify-content: flex-start;
		gap: clamp(1rem, 2.4vw, 2rem);
		width: 100%;
	}

	/* The wordmark — viewport-filling display type */
	.zeus-wordmark {
		font-size: clamp(7rem, 22vw, 19rem);
		letter-spacing: -0.06em;
		color: var(--foreground);
		text-shadow: none;
	}

	/* Principles list — typographic, hairline rules only */
	.zeus-principle {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.75rem 1.5rem;
		padding: 2rem 0;
	}

	.zeus-principle-index {
		font-size: 0.6875rem;
		font-weight: 500;
		grid-column: span 2;
	}

	.zeus-principle-title {
		grid-column: span 2;
	}

	.zeus-principle-body {
		grid-column: span 2;
	}

	@media (min-width: 768px) {
		.zeus-principle {
			grid-template-columns: 5rem minmax(0, 1fr) minmax(0, 42ch);
			gap: 0.5rem 3rem;
			padding: 3rem 0;
			align-items: baseline;
		}
		.zeus-principle-index {
			grid-column: 1 / 2;
			align-self: start;
			padding-top: 0.5rem;
			font-size: 0.75rem;
		}
		.zeus-principle-title {
			grid-column: 2 / 3;
		}
		.zeus-principle-body {
			grid-column: 3 / 4;
			align-self: start;
		}
	}

	/* Promise — two columns of weight on desktop */
	.zeus-promise-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 3rem;
	}
	@media (min-width: 768px) {
		.zeus-promise-grid {
			grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
			gap: 6rem;
		}
	}

</style>
