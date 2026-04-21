<script lang="ts">
import { BrandLockup } from "@acepe/ui";
import { page } from "$app/stores";
import { Download, Menu } from "@lucide/svelte";
import { Drawer, DrawerContent, DrawerOverlay, DrawerPortal, DrawerTrigger } from "@acepe/ui";
import { DiscordLogo, GithubLogo, Star } from "phosphor-svelte";

interface Props {
	showLogin?: boolean;
	showDownload?: boolean;
}

let { showLogin = false, showDownload = false }: Props = $props();
let drawerOpen = $state(false);

const showRoadmap = $derived($page.data.featureFlags?.roadmapEnabled === true);
const githubStars = $derived($page.data.githubStars as number | null);

function formatStars(count: number): string {
	if (count >= 1000) {
		return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	}
	return count.toString();
}

const desktopNavLinkClass =
	"rounded-full px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground";
const mobileNavLinkClass =
	"flex min-h-11 min-w-11 items-center rounded-full px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground";
</script>

<header class="fixed top-4 left-1/2 z-50 w-[calc(100%-3rem)] max-w-4xl -translate-x-1/2">
	<div
		class="flex items-center justify-between rounded-2xl bg-card/45 px-4 py-2.5 backdrop-blur-[30px]"
	>
		<div class="flex shrink-0 items-center">
			<a
				href="/"
				class="flex items-center gap-2 rounded-full px-2 py-1 transition-colors hover:bg-card/70"
			>
				<BrandLockup class="gap-2" markClass="h-6 w-6" wordmarkClass="text-sm text-foreground" />
			</a>
		</div>

		<!-- Desktop nav: centered links -->
		<nav class="hidden items-center justify-center gap-1 md:flex">
			<a href="/blog" class={desktopNavLinkClass}>
				{"Blog"}
			</a>
			{#if showRoadmap}
				<a href="/roadmap" class={desktopNavLinkClass}>
					{"Roadmap"}
				</a>
			{/if}
			<a href="/changelog" class={desktopNavLinkClass}>
				{"Changelog"}
			</a>
			<a href="/pricing" class={desktopNavLinkClass}>
				{"Pricing"}
			</a>
			<a href="/compare" class={desktopNavLinkClass}>
				{"Compare"}
			</a>
		</nav>

		<!-- Desktop nav: right-side icons -->
		<div class="hidden shrink-0 items-center gap-3 md:flex">
			<a
				href="https://github.com/flazouh/acepe"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex h-8 items-center gap-1.5 rounded-full bg-card/70 text-foreground transition-colors hover:bg-card {githubStars ? 'px-3' : 'w-8 justify-center'}"
				aria-label="GitHub"
				title="GitHub"
			>
				<GithubLogo class="h-4 w-4 shrink-0" weight="fill" />
				{#if githubStars}
					<Star class="h-3 w-3 shrink-0 text-amber-400" weight="fill" />
					<span class="font-mono text-xs text-muted-foreground">{formatStars(githubStars)}</span>
				{/if}
			</a>
			<a
				href="https://discord.gg/acepe"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-card/70 text-foreground transition-colors hover:bg-card"
				aria-label="Discord"
				title="Discord"
			>
				<DiscordLogo class="h-4 w-4" weight="fill" />
			</a>
			<a
				href="https://x.com/acepedotdev"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-card/70 text-foreground transition-colors hover:bg-card"
				aria-label="X"
				title="X"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-current">
					<path
						d="M18.244 2H21.5l-7.1 8.117L22 22h-5.956l-4.663-6.104L6.04 22H2.78l7.594-8.68L2 2h6.108l4.215 5.56L18.244 2Zm-1.143 18h1.804L5.128 3.895H3.193L17.1 20Z"
					/>
				</svg>
			</a>
			{#if showDownload}
				<a
					href="/download"
					class="theme-invert-btn group inline-flex h-8 items-center justify-center rounded-full pr-1 pl-4 text-sm font-medium transition-all duration-200"
				>
					{"Download"}
					<span
						class="theme-invert-btn-icon ml-2 flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200"
					>
						<Download class="theme-invert-btn-icon-svg h-3.5 w-3.5 transition-all duration-200" />
					</span>
				</a>
			{/if}
			{#if showLogin}
				<a
					href="/login"
					class="inline-flex h-8 items-center justify-center rounded-full bg-card/70 px-4 text-sm text-foreground transition-colors hover:bg-card"
				>
					{"Login"}
				</a>
			{/if}
		</div>

		<!-- Mobile nav: hamburger + drawer -->
		<div class="flex items-center gap-2 md:hidden">
			<Drawer bind:open={drawerOpen} shouldScaleBackground={false} direction="top">
				<DrawerTrigger
					class="inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full bg-card/70 text-foreground transition-colors hover:bg-card"
					aria-label={"Open menu"}
				>
					<Menu class="h-5 w-5" />
				</DrawerTrigger>
				<DrawerPortal>
					<DrawerOverlay />
					<DrawerContent
						class="!mt-0 flex max-h-[85vh] flex-col gap-1 rounded-b-2xl border-b border-border bg-card/95 p-4 pt-6 pb-8 backdrop-blur-[30px]"
					>
						<div class="mb-2 flex items-center justify-between">
							<a
								href="/"
								class="flex items-center gap-2 rounded-full px-2 py-1 transition-colors hover:bg-card/70"
								onclick={() => (drawerOpen = false)}
							>
								<BrandLockup
									class="gap-2"
									markClass="h-6 w-6"
									wordmarkClass="text-sm text-foreground"
								/>
							</a>
							<div class="flex items-center gap-2">
							<a
								href="https://github.com/flazouh/acepe"
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex h-11 min-h-11 items-center gap-1.5 rounded-full bg-card/70 text-foreground transition-colors hover:bg-card {githubStars ? 'px-3' : 'w-11 min-w-11 justify-center'}"
								aria-label="GitHub"
								title="GitHub"
							>
								<GithubLogo class="h-4 w-4 shrink-0" weight="fill" />
								{#if githubStars}
									<Star class="h-3 w-3 shrink-0 text-amber-400" weight="fill" />
									<span class="font-mono text-xs text-muted-foreground">{formatStars(githubStars)}</span>
								{/if}
							</a>
							<a
								href="https://discord.gg/acepe"
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full bg-card/70 text-foreground transition-colors hover:bg-card"
								aria-label="Discord"
								title="Discord"
							>
								<DiscordLogo class="h-4 w-4" weight="fill" />
							</a>
							<a
								href="https://x.com/acepedotdev"
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full bg-card/70 text-foreground transition-colors hover:bg-card"
								aria-label="X"
								title="X"
							>
								<svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-current">
									<path
										d="M18.244 2H21.5l-7.1 8.117L22 22h-5.956l-4.663-6.104L6.04 22H2.78l7.594-8.68L2 2h6.108l4.215 5.56L18.244 2Zm-1.143 18h1.804L5.128 3.895H3.193L17.1 20Z"
									/>
								</svg>
							</a>
							</div>
						</div>
						<nav class="flex flex-col gap-1">
							<a href="/blog" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
								{"Blog"}
							</a>
							{#if showRoadmap}
								<a href="/roadmap" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
									{"Roadmap"}
								</a>
							{/if}
							<a href="/changelog" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
								{"Changelog"}
							</a>
							<a href="/pricing" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
								{"Pricing"}
							</a>
							<a href="/compare" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
								{"Compare"}
							</a>
							{#if showDownload}
								<a
									href="/download"
									class="theme-invert-btn group mt-2 flex min-h-11 items-center justify-center gap-2 rounded-full py-2.5 pr-1 pl-4 text-sm font-medium"
									onclick={() => (drawerOpen = false)}
								>
									{"Download"}
									<span
										class="theme-invert-btn-icon flex h-6 w-6 items-center justify-center rounded-full"
									>
										<Download class="theme-invert-btn-icon-svg h-3.5 w-3.5" />
									</span>
								</a>
							{/if}
							{#if showLogin}
								<a
									href="/login"
									class="flex min-h-11 items-center justify-center rounded-full bg-card/70 px-4 text-sm text-foreground transition-colors hover:bg-card"
									onclick={() => (drawerOpen = false)}
								>
									{"Login"}
								</a>
							{/if}
						</nav>
					</DrawerContent>
				</DrawerPortal>
			</Drawer>
		</div>
	</div>
</header>
