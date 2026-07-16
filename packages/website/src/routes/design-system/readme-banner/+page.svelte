<script lang="ts">
import DesignSystemHeader from "$lib/design-system/design-system-header.svelte";
import { BrandGradientBackground, BrandLockup } from "@acepe/ui";
</script>

<svelte:head>
	<title>README banner | Acepe Design System</title>
	<meta
		name="description"
		content="Screenshot-ready Acepe README banner using Matter and the Iris brand gradient."
	/>
</svelte:head>

<div class="min-h-screen bg-background text-foreground" data-testid="design-system-readme-banner-page">
	<DesignSystemHeader active="readme-banner" />

	<main class="mx-auto max-w-[92rem] px-6 py-10 sm:px-8 sm:py-14">
		<section class="mb-10 max-w-3xl">
			<p class="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
				Brand foundation / README
			</p>
			<h1 class="font-display text-4xl font-normal tracking-[-0.04em] text-foreground sm:text-5xl">
				README banner
			</h1>
			<p class="mt-4 max-w-[54ch] text-[15px] leading-relaxed text-muted-foreground">
				Iris horizon gradient with Matter display type — left-aligned, dark text, product window
				bleeding off the right edge. Sized for a clean GitHub README capture at 1280×640.
			</p>
		</section>

		<!-- Capture target: fixed 1280×640 banner that scales as one unit so nothing reflows -->
		<div
			class="relative mx-auto aspect-[2/1] w-full max-w-[1280px] overflow-hidden rounded-[6px] border border-border/40 shadow-[0_24px_80px_-32px_rgba(40,20,80,0.4)]"
			data-testid="readme-banner"
			data-slot="readme-banner"
			style="container-type: inline-size;"
		>
			<div
				class="absolute top-0 left-0 origin-top-left overflow-hidden bg-[#ece0ff] text-[#0d0d0d]"
				style="width: 1280px; height: 640px; transform: scale(calc(100cqw / 1280px));"
			>
				<BrandGradientBackground />

				<!-- Product window bleeding off the right edge, as if cut -->
				<div
					class="absolute top-1/2 right-[-6%] w-[56%] -translate-y-1/2 overflow-hidden rounded-[3px] border border-black/10 shadow-[0_40px_100px_-30px_rgba(30,15,70,0.55)]"
				>
					<img
						src="/images/landing/acepe-working-view.webp"
						alt="Acepe running multiple coding agents side by side"
						class="block w-full"
					/>
				</div>

				<!-- Left content -->
				<div class="absolute inset-0 flex flex-col justify-center p-14">
					<BrandLockup wordmarkClass="text-[96px] text-[#0d0d0d]" />
				</div>
			</div>
		</div>

		<p class="mt-6 font-mono text-[12px] text-muted-foreground">
			Capture <code class="text-foreground/80">[data-testid="readme-banner"]</code> at 1280×640 for
			the README.
		</p>
	</main>
</div>
