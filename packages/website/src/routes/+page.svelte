<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { ArrowRightIcon, PillButton, TextShimmer } from '@acepe/ui';
	import AgentIconsRow from '$lib/components/agent-icons-row.svelte';
	import Header from '$lib/components/header.svelte';
	import WaitlistInline from '$lib/components/waitlist-inline.svelte';

	let { data } = $props();
</script>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main class="pt-20">
		<!-- Hero Section -->
		<section class="flex justify-center px-4 pt-16 pb-24 md:px-6 md:pt-24 md:pb-32">
			<div class="text-center">
				<AgentIconsRow size={24} class="mb-6" />
				<h1 class="mb-6 text-3xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[56px]">
					{m.landing_hero_title()}
				</h1>
				<p
					class="mx-auto mb-10 max-w-[800px] text-lg leading-[1.5] font-normal tracking-[-0.03em] text-muted-foreground md:text-[24px]"
				>
					{m.landing_hero_subtitle()}
				</p>
				{#if data.featureFlags.downloadEnabled}
					<PillButton
						href="/download"
						variant="invert"
						size="default"
						class="h-11 py-1.5 pr-1.5 pl-5"
					>
						<TextShimmer>{m.landing_hero_cta()}</TextShimmer>
						{#snippet trailingIcon()}
							<ArrowRightIcon size="lg" />
						{/snippet}
					</PillButton>
				{:else}
					<WaitlistInline ctaVariant="waitlist" />
				{/if}
			</div>
		</section>

		<!-- Main App View Demo -->
		<section class="mx-auto max-w-7xl px-4 pb-32 md:px-6 md:pb-40">
			<img
				src="/images/landing/hero-demo-screenshot.png"
				alt="Acepe main app view"
				class="h-auto w-full rounded-xl border border-border/50"
				loading="lazy"
			/>
		</section>

	</main>

	<!-- Footer -->
	<footer class="border-t border-border/50 px-4 py-12 md:px-6">
		<div class="mx-auto flex max-w-6xl justify-center">
			<a href="https://startupfa.me/s/acepe?utm_source=acepe.dev" target="_blank" rel="noopener">
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
