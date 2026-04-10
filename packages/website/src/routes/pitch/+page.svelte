<script lang="ts">
import { BrandLockup, BrandShaderBackground } from "@acepe/ui";
import { formatPitchProofValue, pitchSections } from "$lib/pitch/content.js";

const workflowComparison = [
	{
		label: "Before",
		accentClass: "border-destructive/30 bg-destructive/6",
		badgeClass: "text-destructive/80 bg-destructive/10",
		steps: [
			"One terminal per agent",
			"Manual conflict hunting",
			"Missed permission prompts",
			"No shared ship-ready state",
		],
	},
	{
		label: "After",
		accentClass: "border-accent/40 bg-accent/8",
		badgeClass: "text-foreground bg-accent/15",
		steps: [
			"One workspace for all agents",
			"Attention queue surfaces blockers",
			"Checkpoint diffs before merge",
			"Clear ship-ready status",
		],
	},
] as const;

const marketSizingInputs = [
	{ label: "Developers", value: "30M+", detail: "AI-assisted developers" },
	{ label: "Target wedge", value: "1%", detail: "Early multi-agent teams" },
	{ label: "Annual seat ACV", value: "$348", detail: "$29 per seat / month" },
	{ label: "Starting SAM", value: "$104M+", detail: "30M x 1% x $348" },
] as const;

const competitionPoints = [
	{ name: "Terminal CLIs", note: "single-session tools", x: "18%", y: "22%", highlight: false },
	{ name: "IDE copilots", note: "editor-native agents", x: "34%", y: "38%", highlight: false },
	{
		name: "PR / CI automation",
		note: "review after execution",
		x: "70%",
		y: "30%",
		highlight: false,
	},
	{ name: "Acepe", note: "live, governed multi-agent work", x: "76%", y: "78%", highlight: true },
] as const;

const tiers = [
	{ name: "Solo", price: "Free forever", features: "Full workspace. Unlimited local sessions." },
	{ name: "Team", price: "$29 / seat / mo", features: "Shared visibility. Approvals. Handoffs." },
	{
		name: "Enterprise",
		price: "Custom",
		features: "SSO. Audit trails. Governance. Remote agents.",
	},
] as const;

const milestones = [
	{ area: "Team workflows", detail: "Shared workspaces, approvals, session handoff" },
	{ area: "Go-to-market", detail: "Developer content and design partners" },
	{ area: "Remote agents", detail: "Cloud-hosted sessions with Acepe observability" },
] as const;

const workflowSteps = ["Launch", "Monitor", "Unblock", "Review", "Ship"] as const;
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
	<main data-pitch-root class="relative">
		<div data-pitch-stack class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 sm:px-8 lg:px-12">
		<nav
			data-pitch-print-hidden
			aria-label="Pitch section navigation"
			class="bg-card/70 border-border/60 sticky top-4 z-10 flex flex-wrap items-center gap-2 rounded-2xl border p-3 backdrop-blur"
		>
			{#each pitchSections as section}
				<a
					href={`#${section.id}`}
					class="bg-background/70 hover:bg-accent text-muted-foreground hover:text-foreground rounded-full px-3 py-1 text-xs font-medium transition-colors"
				>
					{section.title}
				</a>
			{/each}
			<div class="ml-auto">
				<a
					href="/pitch/export"
					class="bg-foreground text-background hover:opacity-90 inline-flex rounded-full px-4 py-2 text-xs font-semibold tracking-[0.16em] uppercase transition-opacity"
				>
					Export PDF
				</a>
			</div>
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
							{#each section.body as bullet}
								<div class="bg-background/45 border-border/40 rounded-2xl border px-4 py-4">
									<p class="text-sm font-medium tracking-[-0.02em]">{bullet}</p>
								</div>
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
							{#each section.body as bullet, i}
								<div class="bg-destructive/5 border-destructive/20 rounded-2xl border p-5">
									<p class="text-destructive/80 mb-2 text-[10px] font-semibold tracking-wider uppercase">Pain point {i + 1}</p>
									<p class="text-base leading-6 font-medium">{bullet}</p>
								</div>
							{/each}
						</div>

					{:else if section.id === 'before-after'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative grid gap-4 lg:grid-cols-2">
							{#each workflowComparison as column}
								<div class={`rounded-[24px] border p-5 ${column.accentClass}`}>
									<span class={`inline-flex rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase ${column.badgeClass}`}>
										{column.label}
									</span>
									<ul class="mt-4 space-y-3">
										{#each column.steps as step}
											<li class="flex items-start gap-3 text-sm leading-6">
												<span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"></span>
												<span>{step}</span>
											</li>
										{/each}
									</ul>
								</div>
							{/each}
						</div>
						<div class="relative flex flex-wrap gap-3">
							{#each section.body as bullet}
								<div class="bg-background/45 border-border/40 rounded-full border px-3 py-1.5 text-xs font-medium">
									{bullet}
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
							<div class="grid gap-3">
								{#each section.body as bullet}
									<div class="bg-background/45 border-border/40 rounded-2xl border px-4 py-4">
										<p class="text-sm font-medium tracking-[-0.02em]">{bullet}</p>
									</div>
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

					{:else if section.id === 'traction'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						{#if section.proofItems}
							<div class="relative grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
								{#each section.proofItems as proofItem}
									<div class="bg-background/60 border-border/50 rounded-[24px] border p-5">
										<p class="text-muted-foreground mb-3 text-[10px] font-semibold tracking-wider uppercase">{proofItem.label}</p>
										<p class="text-5xl leading-none font-semibold tracking-[-0.06em] sm:text-6xl">
											{formatPitchProofValue(proofItem)}
										</p>
										{#if proofItem.note}
											<p class="text-muted-foreground/70 mt-3 text-xs leading-5">{proofItem.note}</p>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
						<div class="relative flex flex-wrap gap-3">
							{#each section.body as bullet}
								<div class="bg-background/45 border-border/40 rounded-full border px-3 py-1.5 text-xs font-medium">
									{bullet}
								</div>
							{/each}
						</div>

					{:else if section.id === 'product'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
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
							{#each section.body as bullet}
								<div class="bg-background/45 border-border/40 rounded-2xl border px-4 py-4">
									<p class="text-xs leading-5 font-medium">{bullet}</p>
								</div>
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
							<div class="space-y-4">
								<div class="bg-accent/10 border-accent/30 rounded-[24px] border p-5">
									<p class="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase">Bottom-up formula</p>
									<p class="mt-3 text-3xl leading-tight font-semibold tracking-[-0.05em]">
										30M+ developers x 1% x $348 = $104M+
									</p>
								</div>
								<div class="grid gap-3">
									{#each section.body as bullet}
										<div class="bg-background/45 border-border/40 rounded-2xl border px-4 py-4">
											<p class="text-sm font-medium tracking-[-0.02em]">{bullet}</p>
										</div>
									{/each}
								</div>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								{#each marketSizingInputs as input}
									<div class="bg-background/45 border-border/40 rounded-[24px] border p-5">
										<p class="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{input.label}</p>
										<p class="mt-3 text-3xl leading-none font-semibold tracking-[-0.05em]">{input.value}</p>
										<p class="text-muted-foreground mt-2 text-xs leading-5">{input.detail}</p>
									</div>
								{/each}
							</div>
						</div>

					{:else if section.id === 'competition'}
						<div class="relative flex flex-col gap-3">
							<p class="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">{section.title}</p>
							<h2 id={`${section.id}-headline`} class="max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
								{section.headline}
							</h2>
							<p class="text-muted-foreground max-w-3xl text-base leading-7 sm:text-lg">{section.summary}</p>
						</div>
						<div class="relative rounded-[28px] border border-border/50 bg-background/35 p-6">
							<div class="pointer-events-none absolute inset-x-14 top-1/2 h-px -translate-y-1/2 bg-border/50"></div>
							<div class="pointer-events-none absolute inset-y-14 left-1/2 w-px -translate-x-1/2 bg-border/50"></div>
							<div class="text-muted-foreground absolute top-4 left-6 text-[10px] font-semibold tracking-wider uppercase">
								Low governance
							</div>
							<div class="text-muted-foreground absolute top-4 right-6 text-[10px] font-semibold tracking-wider uppercase">
								High governance
							</div>
							<div class="text-muted-foreground absolute bottom-4 left-6 text-[10px] font-semibold tracking-wider uppercase">
								Single-agent
							</div>
							<div class="text-muted-foreground absolute bottom-4 right-6 text-[10px] font-semibold tracking-wider uppercase">
								Multi-agent
							</div>
							<div class="relative h-[19rem]">
								{#each competitionPoints as point}
									<div
										class={`absolute w-36 -translate-x-1/2 -translate-y-1/2 rounded-2xl border px-3 py-2 text-center shadow-sm ${
											point.highlight
												? 'border-accent/50 bg-accent/15 text-foreground'
												: 'border-border/50 bg-background/70 text-muted-foreground'
										}`}
										style={`left: ${point.x}; top: ${point.y};`}
									>
										<p class={`text-sm font-semibold ${point.highlight ? 'tracking-[-0.03em]' : ''}`}>{point.name}</p>
										<p class="mt-1 text-[11px] leading-4 opacity-80">{point.note}</p>
									</div>
								{/each}
							</div>
						</div>
						<div class="relative flex flex-wrap gap-3">
							{#each section.body as bullet}
								<div class="bg-background/45 border-border/40 rounded-full border px-3 py-1.5 text-xs font-medium">
									{bullet}
								</div>
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
						<div class="relative flex flex-wrap gap-3">
							{#each section.body as bullet}
								<div class="bg-background/45 border-border/40 rounded-full border px-3 py-1.5 text-xs font-medium">
									{bullet}
								</div>
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
						<div class="relative grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
							<div class="bg-background/50 border-border/50 rounded-[24px] border p-5">
								<p class="text-[10px] font-semibold tracking-wider uppercase">Founder proof</p>
								<ul class="mt-4 space-y-3">
									{#each section.body as bullet}
										<li class="flex items-start gap-3 text-sm leading-6">
											<span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"></span>
											<span>{bullet}</span>
										</li>
									{/each}
								</ul>
							</div>
							<div class="grid gap-3 sm:grid-cols-3">
								{#each milestones as milestone}
									<div class="bg-background/50 border-border/50 rounded-xl border p-4">
										<p class="text-sm font-semibold">{milestone.area}</p>
										<p class="text-muted-foreground mt-1 text-xs leading-5">{milestone.detail}</p>
									</div>
								{/each}
							</div>
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
						<div class="relative grid max-w-3xl gap-3">
							{#each section.body as bullet}
								<div class="bg-background/45 border-border/40 rounded-2xl border px-4 py-4">
									<p class="text-sm font-medium tracking-[-0.02em]">{bullet}</p>
								</div>
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
