<script lang="ts">
import DesignSystemHeader from "$lib/design-system/design-system-header.svelte";
import { BRAND_GRADIENT_IRIS_HORIZON } from "@acepe/ui";

type GradientVariant = {
	id: string;
	name: string;
	character: string;
	bestFor: string;
	background: string;
};

const variants: readonly GradientVariant[] = [
	{
		id: "soft-orbs",
		name: "Soft orbs",
		character: "Airy, dimensional, closest to the current Iris atmosphere.",
		bestFor: "Onboarding, heroes, large cards",
		background:
			"radial-gradient(circle at 18% 18%, #ff9ad1 0%, transparent 42%), radial-gradient(circle at 82% 22%, #a9c2ff 0%, transparent 44%), radial-gradient(circle at 72% 82%, #b79bff 0%, transparent 46%), radial-gradient(circle at 18% 82%, #ffc69d 0%, transparent 44%), #ece0ff",
	},
	{
		id: "corner-wash",
		name: "Corner wash",
		character: "Balanced and calm, with a clear center for content.",
		bestFor: "Product panels, dialogs, text-heavy surfaces",
		background:
			"radial-gradient(70% 75% at 0% 0%, #ff9ad1 0%, transparent 72%), radial-gradient(70% 75% at 100% 0%, #a9c2ff 0%, transparent 72%), radial-gradient(70% 75% at 100% 100%, #b79bff 0%, transparent 72%), radial-gradient(70% 75% at 0% 100%, #ffc69d 0%, transparent 72%), #ece0ff",
	},
	{
		id: "aurora-field",
		name: "Aurora field",
		character: "Expressive and asymmetric, with stronger colour movement.",
		bestFor: "Marketing heroes and editorial moments",
		background:
			"radial-gradient(ellipse at 12% 35%, #ff9ad1 0%, transparent 48%), radial-gradient(ellipse at 58% 0%, #a9c2ff 0%, transparent 52%), radial-gradient(ellipse at 100% 65%, #b79bff 0%, transparent 50%), radial-gradient(ellipse at 42% 100%, #ffc69d 0%, transparent 54%), #ece0ff",
	},
	{
		id: "diagonal-sweep",
		name: "Diagonal sweep",
		character: "Simple and graphic, with predictable colour placement.",
		bestFor: "Compact cards, badges, small previews",
		background:
			"linear-gradient(135deg, #ff9ad1 0%, #ffc69d 28%, #ece0ff 50%, #a9c2ff 72%, #b79bff 100%)",
	},
	{
		id: "horizon",
		name: "Horizon",
		character: "Quiet and spacious, with a soft horizontal rhythm.",
		bestFor: "Full-width bands, login, empty states",
		background: BRAND_GRADIENT_IRIS_HORIZON,
	},
	{
		id: "center-bloom",
		name: "Center bloom",
		character: "Focused and luminous, with a strong central anchor.",
		bestFor: "Feature cards and focused calls to action",
		background:
			"radial-gradient(circle at 50% 48%, #ece0ff 0%, #a9c2ff 27%, transparent 54%), radial-gradient(circle at 18% 22%, #ff9ad1 0%, transparent 48%), radial-gradient(circle at 82% 78%, #b79bff 0%, transparent 50%), linear-gradient(145deg, #ffc69d 0%, #ece0ff 100%)",
	},
];

let selectedId = $state("soft-orbs");
const selected = $derived(variants.find((variant) => variant.id === selectedId) ?? variants[0]);
</script>

<svelte:head>
	<title>Iris gradients | Acepe Design System</title>
	<meta name="description" content="Compare regular CSS Iris gradient directions across realistic Acepe surfaces." />
</svelte:head>

<div class="min-h-screen bg-background text-foreground" data-testid="design-system-gradients-page">
	<DesignSystemHeader active="gradients" />

	<main class="mx-auto max-w-[92rem] px-6 py-10 sm:px-8 sm:py-14">
		<section class="grid gap-8 border-b border-border/60 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)] lg:items-end">
			<div class="max-w-3xl">
				<p class="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Brand foundation / Iris</p>
				<h1 class="max-w-2xl text-4xl font-medium tracking-[-0.04em] text-foreground sm:text-6xl">Choose one atmosphere.</h1>
				<p class="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
					Six regular CSS treatments. The palette never changes; only geometry does. No grain, shader, canvas, or motion.
				</p>
			</div>

			<div class="grid grid-cols-5 gap-2" aria-label="Iris palette">
				{#each ["#ece0ff", "#ff9ad1", "#a9c2ff", "#ffc69d", "#b79bff"] as color}
					<div>
						<div class="aspect-square rounded-md border border-black/10" style:background={color}></div>
						<p class="mt-2 text-center font-mono text-[9px] text-muted-foreground">{color}</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="py-10" aria-labelledby="variants-heading">
			<div class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 id="variants-heading" class="text-xl font-medium">Direction studies</h2>
					<p class="mt-1 text-sm text-muted-foreground">Select a study to inspect it across real product shapes.</p>
				</div>
				<p class="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Selected: {selected.name}</p>
			</div>

			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="gradient-variant-grid">
				{#each variants as variant, index (variant.id)}
					<button
						type="button"
						onclick={() => (selectedId = variant.id)}
						class="group overflow-hidden rounded-xl border text-left transition-[border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {selectedId === variant.id ? 'border-foreground/60' : 'border-border hover:border-foreground/30'}"
						data-testid={`gradient-variant-${variant.id}`}
						aria-pressed={selectedId === variant.id}
					>
						<div class="relative aspect-[16/9]" style:background={variant.background} data-slot="iris-gradient-preview">
							<div class="absolute inset-0 bg-black/5"></div>
							<div class="absolute right-4 bottom-4 left-4 rounded-lg border border-white/30 bg-white/68 p-4 text-[#171719] shadow-sm backdrop-blur-md">
								<p class="text-[10px] font-medium uppercase tracking-[0.14em] opacity-55">Study {String(index + 1).padStart(2, "0")}</p>
								<p class="mt-1 text-lg font-medium tracking-[-0.02em]">{variant.name}</p>
							</div>
						</div>
						<div class="bg-card p-4">
							<p class="text-sm leading-5 text-foreground">{variant.character}</p>
							<p class="mt-2 text-xs text-muted-foreground">Best for: {variant.bestFor}</p>
						</div>
					</button>
				{/each}
			</div>
		</section>

		{#if selected}
			<section class="border-t border-border/60 pt-10" data-testid="gradient-detail-studio">
				<div class="mb-6 grid gap-4 lg:grid-cols-[1fr_1.25fr]">
					<div>
						<p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Applied study</p>
						<h2 class="mt-2 text-3xl font-medium tracking-[-0.03em]">{selected.name}</h2>
						<p class="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{selected.character} Review it below at multiple densities before choosing.</p>
					</div>
					<pre class="overflow-x-auto rounded-lg border border-border bg-card p-4 font-mono text-[11px] leading-5 text-muted-foreground"><code>background: {selected.background};</code></pre>
				</div>

				<div class="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.7fr)]">
					<div class="relative min-h-[30rem] overflow-hidden rounded-2xl border border-border" style:background={selected.background} data-slot="iris-gradient-hero">
						<div class="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent"></div>
						<div class="relative flex min-h-[30rem] flex-col justify-between p-7 text-white sm:p-10">
							<div class="flex items-center justify-between text-xs">
								<span class="font-medium">ACEPE</span><span class="opacity-75">Agent workspace</span>
							</div>
							<div class="max-w-xl">
								<p class="text-xs uppercase tracking-[0.15em] opacity-75">One workspace. Any agent.</p>
								<h3 class="mt-3 text-4xl font-medium tracking-[-0.04em] sm:text-6xl">Build with clarity.</h3>
								<p class="mt-4 max-w-md text-sm leading-6 text-white/80">Run, supervise, and review serious agent work without losing engineering discipline.</p>
								<div class="mt-6 flex gap-2"><span class="rounded-md bg-white px-4 py-2 text-sm font-medium text-black">Open workspace</span><span class="rounded-md border border-white/35 bg-black/10 px-4 py-2 text-sm">View activity</span></div>
							</div>
						</div>
					</div>

					<div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
						<div class="rounded-2xl border border-border bg-card p-4">
							<p class="mb-3 text-xs font-medium text-muted-foreground">Compact panel</p>
							<div class="relative overflow-hidden rounded-xl p-5 text-[#171719]" style:background={selected.background} data-slot="iris-gradient-card">
								<p class="text-xs font-medium opacity-60">Plan status</p><p class="mt-8 text-3xl font-medium tracking-[-0.03em]">Ready to build</p><p class="mt-2 text-sm opacity-65">8 tasks · 3 agents</p>
							</div>
						</div>
						<div class="rounded-2xl border border-border bg-card p-4">
							<p class="mb-3 text-xs font-medium text-muted-foreground">Mobile proportion</p>
							<div class="mx-auto aspect-[9/14] max-h-[19rem] overflow-hidden rounded-[1.5rem] border border-black/10 p-5 text-[#171719]" style:background={selected.background} data-slot="iris-gradient-mobile">
								<div class="flex items-center justify-between text-[10px]"><span>ACEPE</span><span>•••</span></div><p class="mt-20 text-3xl font-medium tracking-[-0.04em]">Your agents, together.</p><div class="mt-5 rounded-lg bg-white/70 p-3 text-xs backdrop-blur">3 sessions need review</div>
							</div>
						</div>
					</div>
				</div>
			</section>
		{/if}
	</main>
</div>
