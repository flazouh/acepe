<script lang="ts">
import type { Snippet } from "svelte";

import { page } from "$app/state";
import { activeHref, designSystemNav } from "$lib/design-system/nav.js";
import { observeThemeChanges } from "$lib/design-system/theme-version.svelte.js";
import {
	setWebsiteThemePreference,
	websiteThemeStore,
	type WebsiteTheme,
} from "$lib/theme/theme.js";

let { children }: { children: Snippet } = $props();

const current = $derived(activeHref(page.url.pathname));

$effect(() => observeThemeChanges(document.documentElement));

function setTheme(theme: WebsiteTheme) {
	setWebsiteThemePreference(theme);
}

/**
 * The active chip is chosen in CSS from the `data-theme` attribute that the
 * blocking script in app.html writes before first paint. Driving it from the
 * store instead would highlight the wrong chip until hydration, because the
 * store SSRs as "dark" whatever the visitor stored.
 */
const toggleClass =
	"rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
</script>

<svelte:head>
	<title>Acepe Design System</title>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<header
		class="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-xl"
	>
		<div class="mx-auto flex max-w-[92rem] items-center justify-between gap-4 px-6 py-3.5">
			<a href="/design-system" class="inline-flex items-center gap-3">
				<span
					class="grid size-7 place-items-center rounded-md border border-border bg-card text-xs font-semibold"
				>
					A
				</span>
				<span>
					<span class="block text-sm font-medium">Acepe design system</span>
					<span class="block text-xs text-muted-foreground">Tokens and components, as shipped</span>
				</span>
			</a>

			<div
				class="ds-theme-toggle flex items-center gap-0.5 rounded-md border border-border/60 bg-card/50 p-0.5"
				role="group"
				aria-label="Theme"
			>
				<button
					type="button"
					data-theme-option="light"
					class={toggleClass}
					aria-pressed={$websiteThemeStore === "light"}
					onclick={() => setTheme("light")}
				>
					Light
				</button>
				<button
					type="button"
					data-theme-option="dark"
					class={toggleClass}
					aria-pressed={$websiteThemeStore === "dark"}
					onclick={() => setTheme("dark")}
				>
					Dark
				</button>
			</div>
		</div>
	</header>

	<div class="mx-auto flex max-w-[92rem] gap-10 px-6 py-8">
		<nav
			class="sticky top-[4.5rem] hidden h-fit w-52 shrink-0 flex-col gap-6 lg:flex"
			aria-label="Design system"
		>
			{#each designSystemNav as section (section.title)}
				<div class="flex flex-col gap-1">
					<p class="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						{section.title}
					</p>
					{#each section.links as link (link.href)}
						{@const isActive = current === link.href}
						<a
							href={link.href}
							aria-current={isActive ? "page" : undefined}
							class="rounded-md px-2 py-1.5 text-sm transition-colors {isActive
								? 'bg-accent text-foreground'
								: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
						>
							{link.label}
						</a>
						{#if isActive && link.anchors}
							<div class="mb-1 ml-2 flex flex-col gap-0.5 border-l border-border/60 pl-3">
								{#each link.anchors as anchor (anchor.id)}
									<a
										href="#{anchor.id}"
										class="py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
									>
										{anchor.label}
									</a>
								{/each}
							</div>
						{/if}
					{/each}
				</div>
			{/each}
		</nav>

		<main class="min-w-0 flex-1 pb-24">
			{@render children()}
		</main>
	</div>
</div>

<style>
:global(:root[data-theme="light"]) .ds-theme-toggle [data-theme-option="light"],
:global(:root[data-theme="dark"]) .ds-theme-toggle [data-theme-option="dark"] {
	background-color: var(--foreground);
	color: var(--background);
}
</style>
