<script lang="ts">
import DsSection from "$lib/design-system/ds-section.svelte";
import { liveToken } from "$lib/design-system/live-token.svelte.js";
import {
	durationTokens,
	easeTokens,
	fontTokens,
	radiusTokens,
	shadowTokens,
} from "$lib/design-system/tokens.js";

let replay = $state(0);
</script>

<div class="flex flex-col gap-14">
	<header class="max-w-2xl">
		<h1 class="text-2xl font-medium tracking-tight">Type, shape, motion</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
			The non-colour foundations. Same rule as the palette: components reference the token, never
			the literal value, so a change here moves the whole app at once.
		</p>
	</header>

	<DsSection
		id="typography"
		title="Typography"
		description="Three families. Display is marketing only; the app itself is sans and mono."
	>
		<div class="flex flex-col gap-3">
			{#each fontTokens as token (token.name)}
				<div class="rounded-lg border border-border/60 bg-card px-4 py-3.5">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<p class="font-mono text-[11px] font-medium">--{token.name}</p>
						<p class="font-mono text-[10px] text-muted-foreground">{liveToken(token.name) || "—"}</p>
					</div>
					<p class="mt-2 text-xl" style:font-family="var(--{token.name})">
						Agents keep working while you read the diff.
					</p>
					<p class="mt-1.5 text-[11px] text-muted-foreground">{token.usage}</p>
				</div>
			{/each}
		</div>

		<div class="mt-4 rounded-lg border border-border/60 bg-card px-4 py-3.5">
			<p class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Scale</p>
			<div class="mt-3 flex flex-col gap-2.5">
				<p class="text-2xl font-medium tracking-tight">Page title — text-2xl</p>
				<p class="text-lg font-medium tracking-tight">Section — text-lg</p>
				<p class="text-sm">Body and controls — text-sm</p>
				<p class="text-xs text-muted-foreground">Meta and captions — text-xs</p>
			</div>
		</div>
	</DsSection>

	<DsSection
		id="radius"
		title="Radius"
		description="One base radius drives four steps. Dense controls get less, big surfaces get more."
	>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each radiusTokens as token (token.name)}
				<div class="rounded-lg border border-border/60 bg-card p-3">
					<div
						class="h-16 border border-border bg-accent"
						style:border-radius="var(--{token.name})"
					></div>
					<p class="mt-2.5 font-mono text-[11px] font-medium">--{token.name}</p>
					<p class="font-mono text-[10px] text-muted-foreground">{liveToken(token.name) || "—"}</p>
					<p class="mt-1 text-[11px] leading-snug text-muted-foreground">{token.usage}</p>
				</div>
			{/each}
		</div>
	</DsSection>

	<DsSection
		id="elevation"
		title="Elevation"
		description="Shadows are shallow on purpose. Height signals layer order, not importance."
	>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
			{#each shadowTokens as token (token.name)}
				<div class="flex flex-col gap-2.5">
					<div
						class="h-16 rounded-lg border border-border/40 bg-card"
						style:box-shadow="var(--{token.name})"
					></div>
					<div>
						<p class="font-mono text-[11px] font-medium">--{token.name}</p>
						<p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">{token.usage}</p>
					</div>
				</div>
			{/each}
		</div>
	</DsSection>

	<DsSection
		id="motion"
		title="Motion"
		description="Durations and easings are shared with the desktop app through @acepe/ui. Press replay to run every duration at once."
	>
		<button
			type="button"
			class="mb-4 rounded-md border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onclick={() => (replay += 1)}
		>
			Replay
		</button>

		<div class="flex flex-col gap-2">
			{#each durationTokens as token (token.name)}
				<div class="rounded-lg border border-border/60 bg-card px-4 py-3">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<p class="font-mono text-[11px] font-medium">--{token.name}</p>
						<p class="font-mono text-[10px] text-muted-foreground">{liveToken(token.name) || "—"}</p>
					</div>
					<div class="mt-2 h-1 overflow-hidden rounded-full bg-accent">
						{#key replay}
							<div
								class="ds-run h-full w-full rounded-full bg-primary"
								style:animation-duration="var(--{token.name})"
							></div>
						{/key}
					</div>
					<p class="mt-1.5 text-[11px] text-muted-foreground">{token.usage}</p>
				</div>
			{/each}
		</div>

		<div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each easeTokens as token (token.name)}
				<div class="rounded-lg border border-border/60 bg-card px-4 py-3">
					<p class="font-mono text-[11px] font-medium">--{token.name}</p>
					<div class="mt-2 h-6">
						{#key replay}
							<div
								class="ds-slide size-6 rounded-md bg-primary"
								style:animation-timing-function="var(--{token.name})"
							></div>
						{/key}
					</div>
					<p class="mt-1.5 text-[11px] leading-snug text-muted-foreground">{token.usage}</p>
				</div>
			{/each}
		</div>
	</DsSection>
</div>

<style>
.ds-run {
	transform-origin: left center;
	animation-name: ds-run;
	animation-timing-function: var(--ease-smooth-out);
	animation-fill-mode: both;
}

@keyframes ds-run {
	from {
		transform: scaleX(0);
	}
	to {
		transform: scaleX(1);
	}
}

.ds-slide {
	animation-name: ds-slide;
	animation-duration: var(--duration-very-slow);
	animation-fill-mode: both;
}

@keyframes ds-slide {
	from {
		transform: translateX(0);
	}
	to {
		transform: translateX(calc(100% * 4));
	}
}

@media (prefers-reduced-motion: reduce) {
	.ds-run,
	.ds-slide {
		animation: none;
	}
}
</style>
