<script lang="ts">
	import { capture, AnalyticsEvent } from '$lib/analytics.js';
	import * as m from '$lib/paraglide/messages.js';
	import Header from '$lib/components/header.svelte';
	import { Download } from '@lucide/svelte';
	import { AppleLogo, GithubLogo } from 'phosphor-svelte';
	import logo from '$lib/assets/favicon.svg';

	const { data } = $props();

	let downloading = $state(false);

	function handleDownload() {
		capture(AnalyticsEvent.Downloaded, {
			arch: 'aarch64',
			version: data.version ?? undefined
		});
		downloading = true;
		setTimeout(() => (downloading = false), 4000);
	}
</script>

<svelte:head>
	<title>Download - Acepe</title>
	<meta name="description" content="Download Acepe for macOS. The agentic developer environment for running Claude Code, Codex, and more — side by side." />
</svelte:head>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={false}
	/>

	<!-- Split screen -->
	<div class="flex min-h-screen flex-col lg:flex-row">

		<!-- Left: content -->
		<div class="flex w-full flex-col justify-center px-8 py-24 lg:w-[45%] lg:px-16 lg:py-0">

			<h1 class="mb-3 text-3xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[48px]">
				Download {m.app_name()}
			</h1>
			<p class="mb-8 max-w-sm text-base leading-relaxed text-muted-foreground md:text-lg">
				{m.landing_hero_title()}
			</p>

			<!-- Download card -->
			<div class="download-card w-full max-w-sm overflow-hidden rounded-xl border border-border/50 bg-card/20">

				<!-- Panel header -->
				<div class="flex h-9 items-center justify-between border-b border-border/50 px-3">
					<div class="flex items-center gap-1.5">
						<AppleLogo weight="fill" class="h-3.5 w-3.5 text-muted-foreground/60" />
						<span class="font-mono text-xs font-semibold text-foreground">macOS</span>
					</div>
					<span class="font-mono text-[10px] text-muted-foreground/50">
						{data.version ? `v${data.version}` : 'latest'}
					</span>
				</div>

				<!-- Body -->
				<div class="p-4">
					<a
						href={data.downloadUrl}
						onclick={handleDownload}
						class="theme-invert-btn flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors"
					>
						{#if downloading}
							<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
								<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
							</svg>
							Downloading...
						{:else}
							<Download class="h-4 w-4" />
							{m.landing_download_button()}
						{/if}
					</a>

					<!-- Requirements -->
					<div class="mt-3 flex flex-col gap-0">
						{#each [{ label: 'macOS', value: '12 Monterey or later' }, { label: 'chip', value: 'Apple Silicon (M1+)' }] as req}
							<div class="flex items-center justify-between border-t border-border/30 py-2 font-mono text-xs">
								<span class="text-muted-foreground/60">{req.label}</span>
								<span class="text-foreground/80">{req.value}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Right: video -->
		<div class="flex w-full items-center justify-center p-6 lg:w-[55%] lg:p-10">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				autoplay
				muted
				loop
				playsinline
				class="w-full max-h-[60vh] rounded-lg object-contain shadow-2xl lg:max-h-[80vh]"
			>
				<source src="/videos/acepe-side-by-side.mp4" type="video/mp4" />
			</video>
		</div>
	</div>

	<!-- Footer -->
	<footer class="border-t border-border/50 px-4 py-12 md:px-6">
		<div class="mx-auto max-w-6xl">
			<div class="grid grid-cols-2 gap-8 md:grid-cols-4">
				<!-- Brand -->
				<div class="col-span-2 md:col-span-1">
					<a href="/" class="mb-3 inline-flex items-center gap-2">
						<img src={logo} alt="" class="h-5 w-5" />
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
	.download-card {
		backdrop-filter: blur(12px);
	}
</style>
