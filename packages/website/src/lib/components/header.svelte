<script lang="ts">
import { BrandLockup } from "@acepe/ui";
import * as m from "$lib/messages.js";
import { browser } from "$app/environment";
import { page } from "$app/stores";
import { Download, Menu, Moon, Sun } from "@lucide/svelte";
import { Drawer, DrawerContent, DrawerOverlay, DrawerPortal, DrawerTrigger } from "@acepe/ui";
import { DiscordLogo, GithubLogo, Star } from "phosphor-svelte";
import {
	THEME_STORAGE_KEY,
	applyThemeToDocument,
	getToggledTheme,
	websiteThemeStore,
	type WebsiteTheme,
} from "$lib/theme/theme";

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
const theme = $derived($websiteThemeStore);

const toggleThemeLabel = $derived(
	theme === "dark" ? m.theme_switch_to_light() : m.theme_switch_to_dark()
);

function handleThemeToggle() {
	const nextTheme = getToggledTheme(theme);

	if (browser) {
		websiteThemeStore.set(nextTheme);
		applyThemeToDocument(nextTheme, document.documentElement);
		window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
	}
}

const desktopNavLinkClass =
	"rounded-full px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground";
const mobileNavLinkClass =
	"flex min-h-11 min-w-11 items-center rounded-full px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground";
</script>

<header class="fixed top-4 left-1/2 z-50 w-[calc(100%-3rem)] max-w-4xl -translate-x-1/2">
	<div
		class="flex items-center justify-between rounded-full bg-card/45 px-4 py-2.5 backdrop-blur-[30px]"
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
				{m.nav_blog()}
			</a>
			{#if showRoadmap}
				<a href="/roadmap" class={desktopNavLinkClass}>
					{m.nav_roadmap()}
				</a>
			{/if}
			<a href="/changelog" class={desktopNavLinkClass}>
				{m.changelog_nav_label()}
			</a>
			<a href="/pricing" class={desktopNavLinkClass}>
				{m.nav_pricing()}
			</a>
			<a href="/compare" class={desktopNavLinkClass}>
				{m.nav_compare()}
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
			<button
				type="button"
				class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-card/70 text-foreground transition-colors hover:bg-card"
				aria-label={toggleThemeLabel}
				title={toggleThemeLabel}
				onclick={handleThemeToggle}
			>
				{#if theme === 'dark'}
					<Sun class="h-4 w-4" />
				{:else}
					<Moon class="h-4 w-4" />
				{/if}
			</button>
			{#if showDownload}
				<a
					href="/download"
					class="theme-invert-btn group inline-flex h-8 items-center justify-center rounded-full pr-1 pl-4 text-sm font-medium transition-all duration-200"
				>
					{m.nav_download()}
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
					{m.login()}
				</a>
			{/if}
		</div>

		<!-- Mobile nav: hamburger + drawer -->
		<div class="flex items-center gap-2 md:hidden">
			<Drawer bind:open={drawerOpen} shouldScaleBackground={false} direction="top">
				<DrawerTrigger
					class="inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full bg-card/70 text-foreground transition-colors hover:bg-card"
					aria-label={m.nav_menu()}
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
								<button
									type="button"
									class="inline-flex h-11 min-h-11 w-11 min-w-11 cursor-pointer items-center justify-center rounded-full bg-card/70 text-foreground transition-colors hover:bg-card"
									aria-label={toggleThemeLabel}
									title={toggleThemeLabel}
									onclick={handleThemeToggle}
								>
									{#if theme === 'dark'}
										<Sun class="h-4 w-4" />
									{:else}
										<Moon class="h-4 w-4" />
									{/if}
								</button>
							</div>
						</div>
						<nav class="flex flex-col gap-1">
							<a href="/blog" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
								{m.nav_blog()}
							</a>
							{#if showRoadmap}
								<a href="/roadmap" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
									{m.nav_roadmap()}
								</a>
							{/if}
							<a href="/changelog" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
								{m.changelog_nav_label()}
							</a>
							<a href="/pricing" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
								{m.nav_pricing()}
							</a>
							<a href="/compare" class={mobileNavLinkClass} onclick={() => (drawerOpen = false)}>
								{m.nav_compare()}
							</a>
							{#if showDownload}
								<a
									href="/download"
									class="theme-invert-btn group mt-2 flex min-h-11 items-center justify-center gap-2 rounded-full py-2.5 pr-1 pl-4 text-sm font-medium"
									onclick={() => (drawerOpen = false)}
								>
									{m.nav_download()}
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
									{m.login()}
								</a>
							{/if}
						</nav>
					</DrawerContent>
				</DrawerPortal>
			</Drawer>
		</div>
	</div>
</header>
