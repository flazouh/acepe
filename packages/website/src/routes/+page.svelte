<script lang="ts">
import { Apple } from "@lucide/svelte";
import Seo from "$lib/components/seo/seo.svelte";
import CommandChip from "$lib/components/landing-v2/command-chip.svelte";
import WarpHeader from "$lib/components/landing-v2/warp-header.svelte";
import AgentIconsRow from "$lib/components/agent-icons-row.svelte";

const BREW = "brew install --cask acepe";

// Each card sits on a self-hosted abstract gradient art (warp-style), assigned
// for brand fit and visual variety. Static lazy-loaded webp — no WebGL, so the
// performance win over the old per-card grain shaders is preserved.
const agents = [
	{
		id: "claude-code",
		name: "Claude Code",
		tagline: "Anthropic's agent, first-class.",
		icon: "/svgs/agents/claude/claude-icon-dark.svg",
		span: "lg:col-span-2 lg:row-span-2",
		image: "/images/landing/bento/art2.webp",
	},
	{
		id: "codex",
		name: "Codex",
		tagline: "OpenAI's coding agent.",
		icon: "/svgs/agents/codex/codex-icon-dark.svg",
		span: "",
		image: "/images/landing/bento/warm.webp",
	},
	{
		id: "cursor",
		name: "Cursor Agent",
		tagline: "Cursor's background agent.",
		icon: "/svgs/agents/cursor/cursor-icon-dark.svg",
		span: "",
		image: "/images/landing/bento/art3.webp",
	},
	{
		id: "opencode",
		name: "OpenCode",
		tagline: "The open-source ACP client.",
		icon: "/svgs/agents/opencode/opencode-logo-dark.svg",
		span: "",
		image: "/images/landing/bento/art4.webp",
	},
	{
		id: "custom",
		name: "Any ACP agent",
		tagline: "Bring your own — if it speaks ACP, it runs here.",
		icon: "/svgs/agents/custom/custom-icon.svg",
		span: "",
		image: "/images/landing/bento/art2.webp",
	},
];

const capabilities = [
	{
		eyebrow: "Orchestrate",
		title: "Run any agent, in parallel",
		body: "Claude Code, Codex, Cursor, and OpenCode run side by side as native sessions. Switch between live work with one keystroke.",
	},
	{
		eyebrow: "Review",
		title: "Read the work like a PR",
		body: "Every tool call, permission prompt, and diff is captured in a canonical transcript — reviewable before anything ships.",
	},
	{
		eyebrow: "Control",
		title: "Checkpoint and intervene",
		body: "Checkpoint each run, revert a file or a whole session, and step in the moment an agent drifts off course.",
	},
];

const homepageKeywords = [
	"AI coding agents",
	"Claude Code",
	"Codex",
	"Cursor Agent",
	"OpenCode",
	"agentic developer environment",
	"agent client protocol",
];

const creamButton =
	"inline-flex h-9 items-center gap-2 rounded-[2px] bg-[#f8f5ee] px-4 text-[14px] font-medium text-[#121212] transition-opacity hover:opacity-90";
const ghostButton =
	"inline-flex h-9 items-center gap-2 rounded-[2px] border border-[#f8f5ee]/20 px-4 text-[14px] font-medium text-[#f8f5ee] transition-colors hover:border-[#f8f5ee]/40";
</script>

<Seo
	title="The Agentic Developer Environment"
	description="Ship better software with any agent. Acepe runs Claude Code, Codex, Cursor Agent, and OpenCode in one native workspace — orchestrate, review, and ship from plan to PR."
	keywords={homepageKeywords}
	canonical="/"
/>

<div class="warp-theme min-h-screen bg-[#121212] text-foreground antialiased">
	<WarpHeader />

	<main>
		<!-- Hero — left-aligned, warp cadence -->
		<section class="mx-auto max-w-[1280px] px-6 pt-20 pb-12 md:pt-28">
			<h1
				class="max-w-[16ch] font-display text-[40px] leading-[1.04] font-normal tracking-[-0.025em] text-foreground md:text-[64px]"
			>
				{"Ship better software with any agent"}
			</h1>
			<p class="mt-6 max-w-[54ch] text-[15px] leading-[1.55] text-muted-foreground md:text-[17px]">
				{"Acepe is a native agentic developer environment. Run Claude Code, Codex, Cursor, and OpenCode locally — orchestrate parallel sessions, review every change, and ship from plan to PR."}
			</p>

			<div class="mt-8 flex flex-wrap items-center gap-3">
				<a href="/download" class={creamButton}>
					{"Download"}
					<Apple class="h-4 w-4" />
				</a>
				<CommandChip command={BREW} />
				<a href="/pricing" class={ghostButton}>{"Contact sales"}</a>
			</div>
		</section>

		<!-- Product surface — greyscale app mock floating on Cosmic Orange -->
		<section class="mx-auto max-w-[1280px] px-6 pb-24 md:pb-32">
			<div class="relative aspect-[16/9] overflow-hidden rounded-[4px] bg-[#0F0F10]">
				<img
					src="/images/landing/hero-grain.jpg"
					alt=""
					aria-hidden="true"
					fetchpriority="high"
					class="absolute inset-0 h-full w-full object-cover"
				/>
				<div class="absolute inset-0 flex items-center justify-center p-6 sm:p-10 md:p-14">
					<img
						src="/images/landing/acepe-working-view.webp"
						alt="Acepe running multiple coding agents side by side"
						class="w-full max-w-[1000px] rounded-md shadow-[0_30px_90px_-24px_rgba(0,0,0,0.65)] [filter:grayscale(1)_contrast(1.03)]"
					/>
				</div>
			</div>
		</section>

		<!-- Bento — our take on warp's partner grid -->
		<section class="border-t border-[#f8f5ee]/10 py-24 md:py-32">
			<div class="mx-auto max-w-[1280px] px-6">
				<h2 class="font-display text-[30px] leading-[1.08] font-normal tracking-[-0.025em] md:text-[45px]">
					{"Runs the agents you already trust"}
				</h2>
				<p class="mt-5 max-w-[58ch] text-[15px] leading-[1.6] text-muted-foreground md:text-[16px]">
					{"One protocol, every leading coding agent. Acepe speaks ACP, so the agent is a choice — never a lock-in."}
				</p>

				<div class="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each agents as agent (agent.id)}
						<div
							class="group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-[4px] bg-[#141414] p-6 {agent.span}"
						>
							<img
								src={agent.image}
								alt=""
								aria-hidden="true"
								loading="lazy"
								decoding="async"
								class="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
							/>
							<div
								class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10"
							></div>

							<img
								src={agent.icon}
								alt={agent.name}
								class="absolute top-6 left-6 h-9 w-9 object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)] transition-transform duration-500 ease-out group-hover:scale-110"
							/>

							<div class="relative z-10">
								<h3 class="font-display text-[18px] font-normal tracking-[-0.01em] text-white">
									{agent.name}
								</h3>
								<p class="mt-1 text-[13px] leading-snug text-white/70">{agent.tagline}</p>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- Capabilities -->
		<section class="border-t border-[#f8f5ee]/10 py-24 md:py-32">
			<div class="mx-auto max-w-[1280px] px-6">
				<h2 class="max-w-[20ch] font-display text-[30px] leading-[1.08] font-normal tracking-[-0.025em] md:text-[45px]">
					{"More agents shouldn't mean more chaos"}
				</h2>
				<div class="mt-14 grid gap-x-10 gap-y-12 md:grid-cols-3">
					{#each capabilities as cap (cap.eyebrow)}
						<div>
							<div class="font-mono text-[11px] uppercase tracking-[0.16em] text-[#FF8001]">
								{cap.eyebrow}
							</div>
							<h3 class="mt-4 font-display text-[20px] font-normal tracking-[-0.01em] text-foreground">
								{cap.title}
							</h3>
							<p class="mt-3 text-[14px] leading-[1.6] text-muted-foreground">{cap.body}</p>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- Get Acepe today — download / brew -->
		<section class="border-t border-[#f8f5ee]/10 py-24 md:py-32">
			<div class="mx-auto max-w-[1280px] px-6">
				<div class="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60">
					{"01 — Download"}
				</div>
				<h2 class="mt-4 font-display text-[32px] leading-[1.05] font-normal tracking-[-0.025em] md:text-[52px]">
					{"Get Acepe today"}
				</h2>
				<p class="mt-5 max-w-[52ch] text-[15px] leading-[1.6] text-muted-foreground md:text-[16px]">
					{"Free to download. Native on macOS. Bring your own agents and ship from one window."}
				</p>

				<div class="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-3">
					<div>
						<div class="flex items-center gap-2 text-foreground">
							<Apple class="h-5 w-5" />
							<span class="font-display text-[18px]">{"macOS"}</span>
						</div>
						<p class="mt-2 text-[13px] text-muted-foreground">{"Apple silicon & Intel"}</p>
						<div class="mt-6 flex flex-col gap-3">
							<a href="/download" class={creamButton + " justify-center"}>{"Download for macOS"}</a>
							<CommandChip command={BREW} class="justify-between" />
						</div>
					</div>
					<div>
						<div class="font-display text-[18px] text-foreground/70">{"Linux"}</div>
						<p class="mt-2 text-[13px] text-muted-foreground">{"On the roadmap"}</p>
						<div class="mt-6">
							<span class="inline-flex h-9 items-center rounded-[2px] border border-[#f8f5ee]/12 px-4 text-[13px] text-muted-foreground/70">
								{"Coming soon"}
							</span>
						</div>
					</div>
					<div>
						<div class="font-display text-[18px] text-foreground/70">{"Windows"}</div>
						<p class="mt-2 text-[13px] text-muted-foreground">{"On the roadmap"}</p>
						<div class="mt-6">
							<span class="inline-flex h-9 items-center rounded-[2px] border border-[#f8f5ee]/12 px-4 text-[13px] text-muted-foreground/70">
								{"Coming soon"}
							</span>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- Footer -->
		<footer class="border-t border-[#f8f5ee]/10 py-14">
			<div class="mx-auto flex max-w-[1280px] flex-col gap-10 px-6 md:flex-row md:items-start md:justify-between">
				<div class="flex max-w-xs flex-col gap-4">
					<AgentIconsRow size={20} class="justify-start opacity-70" />
					<p class="text-[13px] leading-relaxed text-muted-foreground/70">
						{"The Agentic Developer Environment. Every coding agent, one native window."}
					</p>
				</div>
				<div class="grid grid-cols-2 gap-x-16 gap-y-8 sm:grid-cols-3">
					<div class="flex flex-col gap-3">
						<div class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/50">
							{"Product"}
						</div>
						<a href="/download" class="text-[13px] text-foreground/80 hover:text-foreground">{"Download"}</a>
						<a href="/pricing" class="text-[13px] text-foreground/80 hover:text-foreground">{"Pricing"}</a>
						<a href="/changelog" class="text-[13px] text-foreground/80 hover:text-foreground">{"Changelog"}</a>
						<a href="/compare" class="text-[13px] text-foreground/80 hover:text-foreground">{"Compare"}</a>
					</div>
					<div class="flex flex-col gap-3">
						<div class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/50">
							{"Resources"}
						</div>
						<a href="/blog" class="text-[13px] text-foreground/80 hover:text-foreground">{"Blog"}</a>
						<a href="https://github.com/flazouh/acepe" class="text-[13px] text-foreground/80 hover:text-foreground">{"GitHub"}</a>
						<a href="/privacy" class="text-[13px] text-foreground/80 hover:text-foreground">{"Privacy"}</a>
						<a href="/terms" class="text-[13px] text-foreground/80 hover:text-foreground">{"Terms"}</a>
					</div>
					<div class="flex flex-col gap-3">
						<div class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/50">
							{"Connect"}
						</div>
						<a href="https://x.com/acepedotdev" class="text-[13px] text-foreground/80 hover:text-foreground">{"X / Twitter"}</a>
						<a href="https://discord.gg/acepe" class="text-[13px] text-foreground/80 hover:text-foreground">{"Discord"}</a>
					</div>
				</div>
			</div>
			<div class="mx-auto mt-12 max-w-[1280px] px-6">
				<p class="text-[12px] text-muted-foreground/50">{"© 2026 Acepe. All rights reserved."}</p>
			</div>
		</footer>
	</main>
</div>
