<script lang="ts">
	import { BrandLockup, BrandShaderBackground } from '@acepe/ui';
	import { formatPitchProofValue, pitchSections } from '$lib/pitch/content.js';

	const thesisBeatLabels = {
		'platform-neutral': 'Platform-neutral control plane',
		'why-acepe-wins': 'Acepe wins at the operating layer',
		'team-workflow-wedge': 'Team workflow wedge first',
		'raise-unlock': 'Raise unlocks faster execution',
		'first-party-agent-upside': 'First-party agent is upside',
		'why-now-urgency': 'Why now urgency',
	} as const;

	const positioningRows = [
		{ approach: 'Terminal CLI', agents: 'One at a time', visibility: 'Scrollback', governance: 'None' },
		{ approach: 'IDE extensions', agents: 'Built-in only', visibility: 'Editor tab', governance: 'Per-file' },
		{ approach: 'Acepe', agents: 'Any ACP agent', visibility: 'Attention queue', governance: 'Checkpoints + review' },
	] as const;

	const tiers = [
		{ name: 'Solo', price: 'Free', features: 'Desktop app, all agents, checkpoints, SQL Studio, Git integration' },
		{ name: 'Team', price: 'Per seat / mo', features: 'Shared visibility, approval workflows, session handoff, coordination' },
		{ name: 'Enterprise', price: 'Custom', features: 'SSO, audit trails, governance policies, remote agent execution' },
	] as const;

	const milestones = [
		{ area: 'Team features', detail: 'Shared workspaces, approval workflows, session handoff' },
		{ area: 'Remote agents', detail: 'Cloud-hosted sessions with full Acepe observability' },
		{ area: 'Go-to-market', detail: 'Developer community, content, early enterprise pilots' },
		{ area: 'First-party agent', detail: 'Acepe-native agent optimized for the platform context model' },
	] as const;

	const workflowSteps = ['Launch', 'Monitor', 'Unblock', 'Review', 'Ship'] as const;
</script>

<svelte:head>
	<title>Investor Pitch - Acepe</title>
	<meta
		name="description"
		content="Acepe investor pitch: the platform-neutral operating layer for agentic development."
	/>
	<style>
		@page {
			size: 13.333in 7.5in landscape;
			margin: 0;
		}

		[data-pitch-slide] {
			position: relative;
		}

		[data-pitch-slide]::after {
			content: '';
			position: absolute;
			inset: 0;
			border-radius: inherit;
			pointer-events: none;
			z-index: 0;
			opacity: 0.04;
			mix-blend-mode: soft-light;
			background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
		}

		@media print {
			html,
			body {
				background: #161616;
			}

			[data-pitch-root] {
				max-width: none !important;
			}

			[data-pitch-stack] {
				gap: 0 !important;
				max-width: none !important;
				padding: 0 !important;
			}

			[data-pitch-print-hidden] {
				display: none !important;
			}

			[data-pitch-slide] {
				min-height: 7.5in;
			}

			[data-pitch-section] {
				break-after: page;
				page-break-after: always;
				border-radius: 0;
				box-shadow: none;
				margin: 0;
				min-height: 7.5in;
				padding: 64px !important;
			}

			[data-pitch-section]:last-of-type {
				break-after: auto;
				page-break-after: auto;
			}

			[data-pitch-slide]::after {
				opacity: 0.06;
			}
		}
	</style>
</svelte:head>

<div class="bg-background text-foreground relative isolate min-h-screen overflow-hidden">
	<BrandShaderBackground class="pointer-events-none opacity-80" fallback="gradient" />

	<main data-pitch-root class="relative">
		<div data-pitch-stack class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 sm:px-8 lg:px-12">
		<nav
			data-pitch-print-hidden
			aria-label="Pitch section navigation"
			class="bg-card/70 border-border/60 sticky top-4 z-10 flex flex-wrap gap-2 rounded-2xl border p-3 backdrop-blur"
		>
			{#each pitchSections as section}
				<a
					href={`#${section.id}`}
					class="bg-background/70 hover:bg-accent text-muted-foreground hover:text-foreground rounded-full px-3 py-1 text-xs font-medium transition-colors"
				>
					{section.title}
				</a>
			{/each}
		</nav>

			{#each pitchSections as section, index}
				<section
					id={section.id}
					data-pitch-section={section.id}
					data-pitch-slide
					class="bg-card/60 border-border/60 relative flex min-h-[28rem] flex-col gap-6 overflow-hidden rounded-[28px] border px-6 py-8 shadow-lg backdrop-blur sm:px-8 sm:py-10"
					aria-labelledby={`${section.id}-headline`}
				>

					{#if section.id === 'title'}
						<div class="absolute inset-0 opacity-90">
							<BrandShaderBackground class="rounded-[28px]" fallback="gradient" />
						</div>
						<div class="relative flex flex-col gap-4">
							<div class="mb-2 flex flex-wrap items-center justify-between gap-4">
								<BrandLockup class="gap-3" markClass="h-9 w-9" wordmarkClass="text-base tracking-[0.22em]" />
								<p class="bg-background/55 border-border/50 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase backdrop-blur">
									Investor pitch
								</p>
							</div>
							<h1 id={`${section.id}-headline`} class="max-w-4xl text-4xl leading-tight font-semibold tracking-[-0.04em] sm:text-5xl">
								{section.headline}
							</h1>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">
								{section.summary}
							</p>
						</div>
						<div class="relative mt-auto grid gap-4 sm:grid-cols-2">
							{#each section.body as paragraph}
								<p class="text-sm leading-6 text-pretty opacity-80">{paragraph}</p>
							{/each}
						</div>

					{:else if section.id === 'problem'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative grid gap-4 sm:grid-cols-2">
							{#each section.body as paragraph, i}
								<div class="bg-destructive/5 border-destructive/20 rounded-2xl border p-5">
									<p class="text-destructive/80 mb-2 text-[10px] font-semibold tracking-wider uppercase">Pain point {i + 1}</p>
									<p class="text-sm leading-6">{paragraph}</p>
								</div>
							{/each}
						</div>

					{:else if section.id === 'workflow-failures'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative space-y-3">
							{#each section.body as paragraph}
								<div class="bg-background/40 border-border/40 flex items-start gap-3 rounded-xl border p-4">
									<span class="text-destructive/60 mt-0.5 shrink-0 text-base" aria-hidden="true">&#x2717;</span>
									<p class="text-sm leading-6">{paragraph}</p>
								</div>
							{/each}
						</div>

					{:else if section.id === 'solution'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-2xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative grid gap-6 lg:grid-cols-[1fr_1fr]">
							<div class="space-y-3">
								{#each section.body as paragraph}
									<p class="text-sm leading-6 text-pretty">{paragraph}</p>
								{/each}
							</div>
							<div data-pitch-diagram class="flex flex-col gap-0 text-xs">
								<div class="bg-accent/20 border-accent/40 rounded-t-xl border border-b-0 px-4 py-3 text-center">
									<p class="text-[10px] font-semibold tracking-wider uppercase">Acepe Operating Layer</p>
									<div class="mt-2 flex flex-wrap justify-center gap-2">
										<span class="bg-background/60 rounded-md px-2 py-1">Attention Queue</span>
										<span class="bg-background/60 rounded-md px-2 py-1">Checkpoints</span>
										<span class="bg-background/60 rounded-md px-2 py-1">SQL Studio</span>
										<span class="bg-background/60 rounded-md px-2 py-1">Git Panel</span>
									</div>
								</div>
								<div class="bg-muted/20 border-border/50 border px-4 py-2 text-center">
									<p class="text-muted-foreground font-medium">Agent Client Protocol</p>
								</div>
								<div class="border-border/50 grid grid-cols-4 gap-px overflow-hidden rounded-b-xl border border-t-0 bg-border/20">
									<div class="bg-background/60 px-2 py-2 text-center">Claude Code</div>
									<div class="bg-background/60 px-2 py-2 text-center">Codex</div>
									<div class="bg-background/60 px-2 py-2 text-center">Cursor</div>
									<div class="bg-background/60 px-2 py-2 text-center">+ Any</div>
								</div>
							</div>
						</div>

					{:else if section.id === 'product'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
						</div>
						<div class="relative flex flex-wrap items-center gap-2">
							{#each workflowSteps as step, i}
								<span class="bg-accent/15 border-accent/30 rounded-lg border px-3 py-1.5 text-xs font-medium">{step}</span>
								{#if i < workflowSteps.length - 1}
									<span class="text-muted-foreground text-sm" aria-hidden="true">&#x2192;</span>
								{/if}
							{/each}
						</div>
						<div class="relative overflow-hidden rounded-xl border border-border/40 bg-background/30">
							<img
								src="/images/landing/acepe-working-view.png"
								alt="Acepe workspace showing parallel agent sessions, attention queue, and code review"
								class="h-auto w-full"
								loading="lazy"
							/>
						</div>
						<div class="relative grid gap-4 sm:grid-cols-2">
							{#each section.body as paragraph}
								<p class="text-xs leading-5 text-pretty opacity-80">{paragraph}</p>
							{/each}
						</div>

					{:else if section.id === 'market-why-now'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative grid gap-6 lg:grid-cols-[1fr_1fr]">
							<div class="space-y-3">
								{#each section.body as paragraph}
									<p class="text-sm leading-6 text-pretty">{paragraph}</p>
								{/each}
							</div>
							<div data-pitch-table class="bg-background/40 overflow-hidden rounded-xl border border-border/50">
								<table class="w-full text-xs">
									<thead>
										<tr class="border-b border-border/40 bg-background/60">
											<th class="px-3 py-2 text-left font-semibold">Approach</th>
											<th class="px-3 py-2 text-left font-semibold">Agents</th>
											<th class="px-3 py-2 text-left font-semibold">Visibility</th>
											<th class="px-3 py-2 text-left font-semibold">Governance</th>
										</tr>
									</thead>
									<tbody>
										{#each positioningRows as row}
											<tr class="border-b border-border/20 last:border-0 {row.approach === 'Acepe' ? 'bg-accent/15' : ''}">
												<td class="px-3 py-2 font-medium {row.approach === 'Acepe' ? 'text-foreground' : 'text-muted-foreground'}">{row.approach}</td>
												<td class="px-3 py-2 text-muted-foreground">{row.agents}</td>
												<td class="px-3 py-2 text-muted-foreground">{row.visibility}</td>
												<td class="px-3 py-2 text-muted-foreground">{row.governance}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>

					{:else if section.id === 'traction'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						{#if section.proofItems}
							<div class="relative grid gap-4 sm:grid-cols-2">
								{#each section.proofItems as proofItem}
									<div class="bg-background/60 border-border/50 rounded-2xl border p-5">
										<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">{proofItem.label}</p>
										<p class="text-xl font-semibold">{formatPitchProofValue(proofItem)}</p>
										{#if proofItem.note}
											<p class="text-muted-foreground/70 mt-2 text-xs leading-5">{proofItem.note}</p>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
						<div class="relative space-y-3">
							{#each section.body as paragraph}
								<p class="text-sm leading-6 text-pretty opacity-80">{paragraph}</p>
							{/each}
						</div>

					{:else if section.id === 'business-model'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative grid gap-4 sm:grid-cols-3">
							{#each tiers as tier}
								<div class="flex flex-col gap-2 rounded-2xl border p-5 {tier.name === 'Team' ? 'bg-accent/10 border-accent/40' : 'bg-background/50 border-border/50'}">
									<p class="text-[10px] font-semibold tracking-wider uppercase">{tier.name}</p>
									<p class="text-lg font-semibold">{tier.price}</p>
									<p class="text-muted-foreground text-xs leading-5">{tier.features}</p>
								</div>
							{/each}
						</div>
						<div class="relative space-y-3">
							{#each section.body as paragraph}
								<p class="text-sm leading-6 text-pretty opacity-80">{paragraph}</p>
							{/each}
						</div>

					{:else if section.id === 'ask'}
						<div class="absolute inset-0 opacity-40">
							<BrandShaderBackground class="rounded-[28px]" fallback="gradient" />
						</div>
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative grid gap-3 sm:grid-cols-2">
							{#each milestones as milestone}
								<div class="bg-background/50 border-border/50 rounded-xl border p-4">
									<p class="mb-1 text-sm font-semibold">{milestone.area}</p>
									<p class="text-muted-foreground text-xs leading-5">{milestone.detail}</p>
								</div>
							{/each}
						</div>
						<div class="relative space-y-3">
							{#each section.body as paragraph}
								<p class="text-sm leading-6 text-pretty opacity-80">{paragraph}</p>
							{/each}
						</div>
						<div class="relative mt-auto">
							<BrandLockup class="gap-2 opacity-60" markClass="h-5 w-5" wordmarkClass="text-xs tracking-[0.22em]" />
						</div>

					{:else}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative max-w-3xl space-y-4">
							{#each section.body as paragraph}
								<p class="text-base leading-7 text-pretty">{paragraph}</p>
							{/each}
						</div>
					{/if}

					{#if section.thesisBeats.length > 0}
						<div class="relative mt-auto flex flex-wrap gap-1.5">
							{#each section.thesisBeats as thesisBeat}
								<span class="bg-accent/8 text-muted-foreground rounded-md px-2 py-0.5 text-[10px]">{thesisBeatLabels[thesisBeat]}</span>
							{/each}
						</div>
					{/if}

					<div
						data-pitch-print-hidden
						class="relative mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4"
					>
						<p class="text-muted-foreground text-xs font-medium">
							Slide {index + 1} / {pitchSections.length}
						</p>

						<div class="flex flex-wrap items-center gap-2">
							{#if index > 0}
								<a
									data-pitch-prev={pitchSections[index - 1]?.id}
									href={`#${pitchSections[index - 1]?.id}`}
									class="bg-background/70 hover:bg-accent rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
								>
									Previous
								</a>
							{:else}
								<span
									aria-disabled="true"
									class="bg-background/40 text-muted-foreground rounded-full px-3 py-1.5 text-sm font-medium"
								>
									Previous
								</span>
							{/if}

							{#if index < pitchSections.length - 1}
								<a
									data-pitch-next={pitchSections[index + 1]?.id}
									href={`#${pitchSections[index + 1]?.id}`}
									class="bg-foreground text-background hover:opacity-90 rounded-full px-3 py-1.5 text-sm font-medium transition-opacity"
								>
									Next
								</a>
							{:else}
								<span
									aria-disabled="true"
									class="bg-background/40 text-muted-foreground rounded-full px-3 py-1.5 text-sm font-medium"
								>
									Next
								</span>
							{/if}
						</div>
					</div>
				</section>
			{/each}
		</div>
	</main>
</div>
