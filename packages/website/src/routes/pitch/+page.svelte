<script lang="ts">
import { browser } from "$app/environment";
import { BrandLockup } from "@acepe/ui";
import HeroShaderStage from "$lib/components/hero-shader-stage.svelte";
import { formatPitchProofValue, pitchSections } from "$lib/pitch/content.js";

const positioningRows = [
	{
		approach: "Terminal CLI",
		agents: "One at a time",
		visibility: "Scrollback",
		governance: "None",
	},
	{
		approach: "IDE extensions",
		agents: "Built-in only",
		visibility: "Editor tab",
		governance: "Per-file",
	},
	{
		approach: "Acepe",
		agents: "Any ACP agent",
		visibility: "Attention queue",
		governance: "Checkpoints + review",
	},
] as const;

const tiers = [
	{
		name: "Solo",
		price: "Free",
		features: "Desktop app, all agents, checkpoints, SQL Studio, Git integration",
	},
	{
		name: "Team",
		price: "Per seat / mo",
		features: "Shared visibility, approval workflows, session handoff, coordination",
	},
	{
		name: "Enterprise",
		price: "Custom",
		features: "SSO, audit trails, governance policies, remote agent execution",
	},
] as const;

const milestones = [
	{ area: "Team features", detail: "Shared workspaces, approval workflows, session handoff" },
	{ area: "Remote agents", detail: "Cloud-hosted sessions with full Acepe observability" },
	{ area: "Go-to-market", detail: "Developer community, content, early enterprise pilots" },
	{
		area: "First-party agent",
		detail: "Acepe-native agent optimized for the platform context model",
	},
] as const;

const workflowSteps = ["Launch", "Monitor", "Unblock", "Review", "Ship"] as const;

const viewModes = [
	{
		id: "agent",
		label: "Side by Side",
		color: "#99FFE4",
		image: "/images/pitch/pitch-view-agent.webp",
		w: 2540,
		h: 1650,
	},
	{
		id: "by-project",
		label: "By Project",
		color: "#FF8D20",
		image: "/images/pitch/pitch-view-by-project.webp",
		w: 2540,
		h: 1650,
	},
	{
		id: "single",
		label: "Single Agent",
		color: "#9858FF",
		image: "/images/pitch/pitch-view-single.webp",
		w: 2540,
		h: 1650,
	},
	{
		id: "kanban",
		label: "Kanban",
		color: "#FF78F7",
		image: "/images/pitch/pitch-view-kanban.webp",
		w: 2540,
		h: 1650,
	},
] as const;

let activeView = $state("agent");

const agentIcons = [
	{ name: "Claude Code", icon: "/svgs/agents/claude/claude-icon-dark.svg" },
	{ name: "Codex", icon: "/svgs/agents/codex/codex-icon-dark.svg" },
	{ name: "Cursor", icon: "/svgs/agents/cursor/cursor-icon-dark.svg" },
	{ name: "Copilot", icon: "/svgs/agents/copilot/copilot-icon-dark.svg" },
	{ name: "OpenCode", icon: "/svgs/agents/opencode/opencode-logo-dark.svg" },
] as const;
const slideTitleClass =
	"max-w-4xl whitespace-pre-line text-3xl leading-[1.12] font-semibold tracking-[0.015em] sm:text-[2.75rem]";
const slideDescriptionClass =
	"text-muted-foreground text-base leading-7 text-pretty sm:text-lg max-w-2xl";
const slideSummaryClass = `max-w-3xl ${slideDescriptionClass}`;
</script>

<svelte:head>
	<title>Investor Pitch - Acepe</title>
	<meta
		name="description"
		content="Acepe investor pitch: the platform-neutral operating layer for agentic development."
	/>
	<link rel="preload" href="/images/pitch/pitch-view-agent.webp" as="image" type="image/webp" />
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

		[data-pitch-section]:not(:first-of-type) {
			content-visibility: auto;
			contain-intrinsic-size: auto 30rem;
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
	<div class="pointer-events-none fixed inset-0 -z-10" data-pitch-print-hidden>
		{#if browser}
			<HeroShaderStage heightClass="h-screen" accentRing={false} />
		{/if}
	</div>

	<main data-pitch-root class="relative">
		<div data-pitch-stack class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 sm:px-8 lg:px-12">
		<nav
			data-pitch-print-hidden
			aria-label="Pitch section navigation"
			class="bg-card/70 border-border/60 sticky top-4 z-10 flex flex-wrap items-center justify-between gap-1.5 rounded-xl border px-5 py-2 backdrop-blur"
		>
			{#each pitchSections as section}
				<a
					href={`#${section.id}`}
					class="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-2.5 py-1 text-[11px] font-medium tracking-[0.04em] transition-colors"
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
					class="bg-card border-border/60 relative flex min-h-[30rem] flex-col gap-12 overflow-hidden rounded-2xl border px-10 py-14 sm:px-14 sm:py-16"
					aria-labelledby={`${section.id}-headline`}
				>
					<div class="relative flex items-center justify-between gap-4">
						<BrandLockup class="gap-2.5" markClass="h-6 w-6" wordmarkClass="text-[11px] tracking-[0.22em]" />
						<p class="text-muted-foreground text-[10px] font-semibold tracking-[0.22em] uppercase">
							{section.id === 'title' ? 'Investor pitch' : section.title}
						</p>
					</div>

					{#if section.id === 'title'}
						<div class="relative flex flex-col gap-6">
							<h1 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h1>
							<p class={slideDescriptionClass}>
								{section.summary}
							</p>
						</div>
						<div class="relative flex flex-col gap-5">
							<div class="flex flex-wrap items-center gap-2">
								{#each viewModes as view}
									<button
										type="button"
										onclick={() => activeView = view.id}
										class="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors {activeView === view.id ? 'bg-foreground text-background' : 'text-muted-foreground border border-border/40 hover:text-foreground'}"
									>
										<span class="inline-block h-2 w-2 rounded-full" style="background: {view.color}"></span>
										{view.label}
									</button>
								{/each}
							</div>
							<div class="relative overflow-hidden rounded-lg border border-border/40">
								{#each viewModes as view}
									{#if activeView === view.id}
										<img
											src={view.image}
											alt="Acepe {view.label} view"
											width={view.w}
											height={view.h}
											class="h-auto w-full"
											loading={view.id === "agent" ? "eager" : "lazy"}
											decoding="async"
											fetchpriority={view.id === "agent" ? "high" : "low"}
										/>
									{/if}
								{/each}
							</div>
						</div>

					{:else if section.id === 'problem'}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
							<div class="flex flex-col gap-3">
								{#each section.body as paragraph}
									<p class={slideDescriptionClass}>{paragraph}</p>
								{/each}
							</div>
						</div>

					{:else if section.id === 'workflow-failures'}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
							<div class="flex flex-col gap-3">
								{#each section.body as paragraph}
									<p class={slideDescriptionClass}>{paragraph}</p>
								{/each}
							</div>
						</div>

					{:else if section.id === 'solution'}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
							<div class="flex flex-col gap-3">
								{#each section.body as paragraph}
									<p class={slideDescriptionClass}>{paragraph}</p>
								{/each}
							</div>
						</div>
						<div data-pitch-diagram class="flex flex-col gap-6">
							<p class="text-muted-foreground text-sm">Works with the agents you already use</p>
							<div class="flex flex-wrap items-center gap-6">
								{#each agentIcons as agent}
									<div class="flex items-center gap-2.5">
										<img src={agent.icon} alt={agent.name} class="h-7 w-7 object-contain" />
										<span class="text-sm font-medium">{agent.name}</span>
									</div>
								{/each}
								<span class="text-muted-foreground/60 text-sm">+ any ACP agent</span>
							</div>
						</div>

					{:else if section.id === 'product'}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
						</div>
						<div class="relative flex flex-col gap-4">
							<div class="flex items-center gap-1 rounded-full bg-background/40 border border-border/40 p-1 self-start">
								{#each workflowSteps as step, i}
									<span class="rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors {i === 0 ? 'bg-foreground text-background' : 'text-muted-foreground'}">{step}</span>
								{/each}
							</div>
							<div class="relative overflow-hidden rounded-lg border border-border/40">
								<img
									src="/images/landing/acepe-working-view.webp"
									alt="Acepe workspace showing parallel agent sessions, attention queue, and code review"
									width="3024"
									height="1898"
									class="h-auto w-full"
									loading="lazy"
									decoding="async"
								/>
							</div>
						</div>

					{:else if section.id === 'market-why-now'}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
							<div class="flex flex-col gap-3">
								{#each section.body as paragraph}
									<p class={slideDescriptionClass}>{paragraph}</p>
								{/each}
							</div>
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

					{:else if section.id === 'traction'}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
							<p class={slideDescriptionClass}>{section.summary}</p>
						</div>
						{#if section.proofItems}
							<div class="relative flex flex-col gap-4">
								{#each section.proofItems as proofItem}
									<div class="border-border/50 border-l-2 pl-5">
										<p class="text-muted-foreground mb-2 text-[10px] font-semibold tracking-[0.18em] uppercase">{proofItem.label}</p>
										<p class="text-2xl font-semibold tracking-[-0.02em]">{formatPitchProofValue(proofItem)}</p>
										{#if proofItem.note}
											<p class="text-muted-foreground/70 mt-2 text-xs leading-5">{proofItem.note}</p>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

					{:else if section.id === 'business-model'}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
							<p class={slideDescriptionClass}>{section.summary}</p>
						</div>
						<div class="relative grid gap-px overflow-hidden rounded-lg border border-border/50 bg-border/30 sm:grid-cols-3">
							{#each tiers as tier}
								<div class="flex flex-col gap-2 p-5 {tier.name === 'Team' ? 'bg-accent/10' : 'bg-card/80'}">
									<p class="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase">{tier.name}</p>
									<p class="text-lg font-semibold tracking-[-0.02em]">{tier.price}</p>
									<p class="text-muted-foreground text-xs leading-5">{tier.features}</p>
								</div>
							{/each}
						</div>

					{:else if section.id === 'ask'}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
							<p class={slideDescriptionClass}>{section.summary}</p>
						</div>
						<div class="relative flex flex-col gap-3">
							{#each milestones as milestone}
								<p class={slideDescriptionClass}>
									<span class="text-foreground font-semibold">{milestone.area}.</span> {milestone.detail}
								</p>
							{/each}
						</div>

					{:else}
						<div class="relative flex flex-col gap-6">
							<h2 id={`${section.id}-headline`} class={slideTitleClass}>
								{section.headline}
							</h2>
							<div class="flex flex-col gap-3 max-w-3xl">
								{#each section.body as paragraph}
									<p class={slideDescriptionClass}>{paragraph}</p>
								{/each}
							</div>
						</div>
					{/if}

					<div
						data-pitch-print-hidden
						class="relative mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4"
					>
						<p class="text-muted-foreground text-xs font-medium">
							Slide {index + 1} / {pitchSections.length}
						</p>
					</div>
				</section>
			{/each}
		</div>
	</main>
</div>
