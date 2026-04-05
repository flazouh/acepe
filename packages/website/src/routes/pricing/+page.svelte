<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { TextShimmer } from '@acepe/ui';
	import Header from '$lib/components/header.svelte';
	import { Check, ArrowRight, Terminal } from '@lucide/svelte';
	import { GithubLogo } from 'phosphor-svelte';
	import logo from '$lib/assets/logo.svg';
	import logoDark from '../../../../../assets/logo-dark.svg';
	import { pricingFaqItems } from './faq.js';

	let { data } = $props();
</script>

<svelte:head>
	<title>Pricing - Acepe</title>
	<meta
		name="description"
		content="Choose the plan that fits your workflow. Free forever for individuals, Premium for power users, Enterprise for teams."
	/>
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
				<div
					class="mb-5 inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/30 px-3 py-1"
				>
					<span class="font-mono text-xs text-muted-foreground">open-source &amp; free</span
					>
				</div>
				<h1
					class="mb-4 text-3xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[56px]"
				>
					Simple, transparent pricing
				</h1>
				<p
					class="mx-auto max-w-[600px] text-lg leading-[1.5] text-muted-foreground md:text-[22px]"
				>
					Start free, no credit card required. Upgrade when your workflow demands it.
				</p>
			</div>
		</section>

		<!-- Pricing Cards -->
		<section class="mx-auto max-w-5xl px-4 pb-32 md:px-6">
			<div class="grid gap-6 md:grid-cols-3">
				<!-- Free Tier -->
				<div
					class="pricing-card flex flex-col overflow-hidden rounded-xl border border-border/50 bg-card/20"
				>
					<div
						class="flex h-9 items-center justify-between border-b border-border/50 px-3"
					>
						<span class="font-mono text-xs font-semibold text-foreground">Free</span>
						<span class="font-mono text-[10px] text-muted-foreground/60">v1.0</span>
					</div>

					<div class="flex flex-1 flex-col p-5">
						<div class="pricing-info">
							<div class="mb-1.5 flex items-baseline gap-1.5">
								<span
									class="font-mono text-3xl font-bold tracking-tight text-foreground"
									>$0</span
								>
								<span class="font-mono text-xs text-muted-foreground">/mo</span>
							</div>
							<p class="text-[13px] leading-relaxed text-muted-foreground">
								Everything you need for agentic development.
							</p>
						</div>

						<a
							href="/download"
							class="theme-invert-btn mt-6 mb-6 flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors"
						>
							<Terminal class="h-3.5 w-3.5" />
							Get started
						</a>

						<div class="flex flex-col gap-0">
							<div
								class="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50"
							>
								includes
							</div>
							{#each ['Unlimited local agent sessions', 'Multi-agent support', 'Session history & search', 'Checkpoints & snapshots', 'Built-in SQL Studio', 'Git integration & diff viewer', 'Keyboard-first workflow'] as feature}
								<div
									class="flex items-center gap-2.5 border-t border-border/30 py-2 font-mono text-xs text-muted-foreground"
								>
									<Check class="h-3 w-3 shrink-0 text-foreground/50" />
									{feature}
								</div>
							{/each}
						</div>
					</div>
				</div>

				<!-- Premium Tier -->
				<div
					class="pricing-card premium-card relative flex flex-col overflow-hidden rounded-xl border border-primary/30 bg-card/20"
				>
					<div
						class="flex h-9 items-center justify-between border-b px-3"
						style="border-color: color-mix(in srgb, var(--primary) 20%, var(--border));"
					>
						<span class="font-mono text-xs font-semibold text-primary">Premium</span>
						<span
							class="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary"
							>soon</span
						>
					</div>

					<div class="flex flex-1 flex-col p-5">
						<div class="pricing-info">
							<div class="mb-1.5 flex items-baseline gap-1.5">
								<span
									class="font-mono text-3xl font-bold tracking-tight text-foreground"
									>$20</span
								>
								<span class="font-mono text-xs text-muted-foreground">/mo</span>
							</div>
							<p class="text-[13px] leading-relaxed text-muted-foreground">
								Cloud sync, integrations, and mobile access.
							</p>
						</div>

						<button
							disabled
							class="mt-6 mb-6 flex h-9 cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-primary/10 text-sm font-medium text-primary/60 transition-colors"
						>
							<TextShimmer class="text-primary">Coming soon</TextShimmer>
						</button>

						<div class="flex flex-col gap-0">
							<div
								class="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50"
							>
								everything in free, plus
							</div>
							{#each [{ name: 'Cloud agents', desc: 'run on remote machines' }, { name: 'Linear integration', desc: 'issue tracking' }, { name: 'Mobile app', desc: 'monitor on the go' }, { name: 'Session sync', desc: 'across devices' }, { name: 'Priority support', desc: 'fast response' }] as feature}
								<div
									class="flex items-start gap-2.5 border-t py-2 font-mono text-xs"
									style="border-color: color-mix(in srgb, var(--primary) 10%, var(--border));"
								>
									<Check class="mt-0.5 h-3 w-3 shrink-0 text-primary" />
									<span>
										<span class="text-foreground">{feature.name}</span>
										<span class="text-muted-foreground/60"> — {feature.desc}</span>
									</span>
								</div>
							{/each}
						</div>
					</div>
				</div>

				<!-- Enterprise Tier -->
				<div
					class="pricing-card flex flex-col overflow-hidden rounded-xl border border-border/50 bg-card/20"
				>
					<div
						class="flex h-9 items-center justify-between border-b border-border/50 px-3"
					>
						<span class="enterprise-title font-mono text-xs font-semibold">Enterprise</span
						>
						<span class="font-mono text-[10px] text-muted-foreground/60">custom</span>
					</div>

					<div class="flex flex-1 flex-col p-5">
						<div class="pricing-info">
							<div class="mb-1.5 flex items-baseline gap-1.5">
								<span
									class="font-mono text-3xl font-bold tracking-tight text-foreground"
									>Custom</span
								>
							</div>
							<p class="text-[13px] leading-relaxed text-muted-foreground">
								Dedicated infrastructure, SSO, and SLAs for your team.
							</p>
						</div>

						<a
							href="mailto:sasha.zelts@acepe.dev"
							class="mt-6 mb-6 flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
						>
							Contact us
							<ArrowRight class="h-3.5 w-3.5" />
						</a>

						<div class="flex flex-col gap-0">
							<div
								class="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50"
							>
								everything in premium, plus
							</div>
							{#each ['SSO & SAML authentication', 'Dedicated cloud infrastructure', 'Custom agent integrations', 'Usage analytics & audit logs', 'SLA & dedicated support', 'Volume licensing'] as feature}
								<div
									class="flex items-center gap-2.5 border-t border-border/30 py-2 font-mono text-xs text-muted-foreground"
								>
									<Check class="h-3 w-3 shrink-0 text-foreground/50" />
									{feature}
								</div>
							{/each}
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- FAQ Section -->
		<section class="border-t border-border/50 px-4 py-24 md:px-6">
			<div class="mx-auto max-w-2xl">
				<div class="mb-12 flex items-center justify-center gap-2">
					<span
						class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50"
						>//</span
					>
					<h2
						class="font-mono text-sm font-medium uppercase tracking-wider text-muted-foreground"
					>
						FAQ
					</h2>
				</div>
				<div class="flex flex-col gap-0">
					{#each pricingFaqItems as item}
						<div class="border-t border-border/30 py-5">
							<h3 class="mb-2 text-sm font-medium text-foreground">{item.q}</h3>
							<p class="text-[13px] leading-relaxed text-muted-foreground">
								{item.a}
							</p>
							{#if item.comparisonLink !== null}
								<a
									href={item.comparisonLink.href}
									class="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground transition-colors hover:text-primary"
								>
									{item.comparisonLink.label}
									<ArrowRight class="h-3.5 w-3.5" />
								</a>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</section>
	</main>

	<!-- Footer -->
	<footer class="border-t border-border/50 px-4 py-12 md:px-6">
		<div class="mx-auto max-w-6xl">
			<div class="mx-auto grid w-fit grid-cols-2 gap-8 md:grid-cols-4">
				<!-- Brand -->
				<div class="col-span-2 md:col-span-1">
					<a href="/" class="mb-3 inline-flex items-center gap-2">
						<img src={logo} alt="" class="h-6 w-6 dark:hidden" />
						<img src={logoDark} alt="" class="hidden h-6 w-6 dark:block" />
						<span class="text-base font-bold tracking-wide">{m.app_name()}</span>
					</a>
					<p class="max-w-[200px] text-[13px] leading-relaxed text-muted-foreground">
						{m.landing_hero_title()}
					</p>
				</div>

				<!-- Product -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{m.footer_product()}
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a href="/blog" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.nav_blog()}
							</a>
						</li>
						<li>
							<a href="/changelog" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.changelog_nav_label()}
							</a>
						</li>
						<li>
							<a href="/pricing" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.nav_pricing()}
							</a>
						</li>
						<li>
							<a href="/compare" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.nav_compare()}
							</a>
						</li>
						{#if data.featureFlags?.roadmapEnabled}
							<li>
								<a href="/roadmap" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
									{m.nav_roadmap()}
								</a>
							</li>
						{/if}
					</ul>
				</div>

				<!-- Resources -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{m.footer_resources()}
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

					<h3 class="mt-6 mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						Contact
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a
								href="mailto:sasha.zelts@acepe.dev"
								class="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
							>
								sasha.zelts@acepe.dev
							</a>
						</li>
					</ul>
				</div>

				<!-- Legal -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{m.footer_legal()}
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a href="/privacy" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.footer_privacy()}
							</a>
						</li>
						<li>
							<a href="/terms" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.footer_terms()}
							</a>
						</li>
					</ul>
				</div>
			</div>

			<!-- Bottom bar -->
			<div class="mt-10 border-t border-border/30 pt-6">
				<span class="font-mono text-[11px] text-muted-foreground/50">
					{m.footer_copyright({ year: new Date().getFullYear().toString() })}
				</span>
			</div>
		</div>
	</footer>
</div>

<style>
	.pricing-card {
		backdrop-filter: blur(12px);
	}

	.premium-card {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--primary) 4%, var(--card)) 0%,
			color-mix(in srgb, var(--primary) 1%, var(--background)) 100%
		);
	}

	.pricing-info {
		min-height: 5.5rem;
	}

	.enterprise-title {
		color: #9858ff;
	}
</style>
