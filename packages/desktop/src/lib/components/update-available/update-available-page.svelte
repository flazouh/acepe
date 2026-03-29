<script lang="ts">
	import { ArrowRightIcon, PillButton, SegmentedProgress } from "@acepe/ui";
	import {
		GrainGradientShapes,
		type GrainGradientUniforms,
		getShaderColorFromString,
		getShaderNoiseTexture,
		grainGradientFragmentShader,
		ShaderFitOptions,
		ShaderMount,
	} from "@paper-design/shaders";
	import Bug from "phosphor-svelte/lib/Bug";
	import Lightning from "phosphor-svelte/lib/Lightning";
	import RocketLaunch from "phosphor-svelte/lib/RocketLaunch";
	import Warning from "phosphor-svelte/lib/Warning";
	import { type Component, onDestroy, onMount } from "svelte";
	import type { ChangelogEntry, ChangeType } from "$lib/changelog/index.js";
	import { getLatestChangelog, groupChangesByType } from "$lib/changelog/index.js";
	import * as m from "$lib/paraglide/messages.js";
	import logo from "../../../../../../assets/logo.svg?url";

	interface Props {
		version: string;
		onInstall: () => void;
		onSkip: () => void;
	}

	let { version, onInstall, onSkip }: Props = $props();

	let shaderContainer: HTMLDivElement | null = $state(null);
	let shaderMountRef: ShaderMount | null = null;

	const latestChangelog: ChangelogEntry | undefined = getLatestChangelog();
	const changeGroups = $derived(
		latestChangelog ? groupChangesByType(latestChangelog.changes) : []
	);

	const changeTypeConfig: Record<ChangeType, { icon: Component; hex: string; label: string }> = {
		feature: { icon: RocketLaunch, hex: "var(--success)", label: "Features" },
		fix: { icon: Bug, hex: "#FF5D5A", label: "Fixes" },
		improvement: { icon: Lightning, hex: "#FF8D20", label: "Improvements" },
		breaking: { icon: Warning, hex: "#FF5D5A", label: "Breaking" },
	};

	const totalChanges = $derived(latestChangelog ? latestChangelog.changes.length : 0);

	function handleKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			onInstall();
		}
		if (event.key === "Escape") {
			event.preventDefault();
			onSkip();
		}
	}

	onMount(() => {
		window.addEventListener("keydown", handleKeydown);
		void initShader();
	});

	async function initShader() {
		if (!shaderContainer) return;

		const noiseTexture = getShaderNoiseTexture();

		if (noiseTexture && !noiseTexture.complete) {
			await new Promise<void>((resolve, reject) => {
				noiseTexture.onload = () => resolve();
				noiseTexture.onerror = () => reject(new Error("Failed to load noise texture"));
			});
		}

		const containerWidth = shaderContainer.offsetWidth;
		const containerHeight = shaderContainer.offsetHeight;

		shaderMountRef = new ShaderMount(
			shaderContainer,
			grainGradientFragmentShader,
			{
				u_colorBack: getShaderColorFromString("#1a1a1a"),
				u_colors: [
					getShaderColorFromString("#F77E2C"),
					getShaderColorFromString("#ff8558"),
					getShaderColorFromString("#d69d5c"),
					getShaderColorFromString("#ffb380"),
				],
				u_colorsCount: 4,
				u_softness: 0.3,
				u_intensity: 0.8,
				u_noise: 0.15,
				u_shape: GrainGradientShapes.corners,
				u_noiseTexture: noiseTexture,
				u_fit: ShaderFitOptions.cover,
				u_scale: 1,
				u_rotation: 0,
				u_originX: 0.5,
				u_originY: 0.5,
				u_offsetX: 0,
				u_offsetY: 0,
				u_worldWidth: containerWidth,
				u_worldHeight: containerHeight,
			} satisfies Partial<GrainGradientUniforms>,
			{ alpha: false, premultipliedAlpha: false },
			0.5
		);
	}

	onDestroy(() => {
		window.removeEventListener("keydown", handleKeydown);
		shaderMountRef?.dispose();
	});
</script>

<!-- Shader background layer -->
<div class="absolute inset-0 bg-[#1a1a1a]">
	<div bind:this={shaderContainer} class="absolute inset-0"></div>
</div>

<!-- Content layer -->
<div
	class="relative z-10 flex flex-col items-center justify-center h-full w-full max-w-xl mx-auto px-6 py-12"
>
	<!-- Card -->
	<div class="update-available-card flex flex-col w-full rounded-2xl bg-background/80 overflow-hidden">
		<!-- Header section -->
		<div class="flex flex-col gap-5 p-8 pb-5">
			<!-- Logo + version row -->
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<img src={logo} alt="Acepe Logo" class="w-8 h-8" />
					<span class="text-lg font-semibold tracking-wider text-foreground">ACEPE</span>
				</div>
				<span class="font-mono text-[11px] text-muted-foreground/50 bg-muted/40 px-2.5 py-0.5 rounded-full">
					v{version}
				</span>
			</div>

			<!-- Title + subtitle -->
			<div class="flex flex-col gap-1.5">
				<h1 class="text-2xl font-bold text-foreground tracking-[-0.02em]">
					{m.update_available_title()}
				</h1>
				<p class="text-sm text-muted-foreground">
					{m.update_available_subtitle()}
				</p>
			</div>
		</div>

		<!-- Changelog preview -->
		{#if latestChangelog && changeGroups.length > 0}
			<div class="flex flex-col gap-0 px-8 pb-2">
				<!-- Section label -->
				<div class="flex items-center gap-2 mb-3">
					<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">//</span>
					<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{m.update_available_whats_new()}
					</span>
					{#if latestChangelog.highlights}
						<span class="text-[10px] text-muted-foreground/40 ml-auto truncate max-w-[200px]">
							{latestChangelog.highlights}
						</span>
					{/if}
				</div>

				<!-- Change groups -->
				<div class="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto">
					{#each changeGroups as group (group.type)}
						{@const config = changeTypeConfig[group.type]}
						{@const SectionIcon = config.icon}

						<div class="changelog-group">
							<!-- Group header -->
							<div class="changelog-group-header">
								<SectionIcon weight="fill" class="size-3" style="color: {config.hex}" />
								<span>{config.label}</span>
								<span class="ml-auto text-muted-foreground/30">{group.items.length}</span>
							</div>

							<!-- Items -->
							{#each group.items as change, i (`${group.type}-${i}`)}
								<div class="changelog-group-row">
									<span class="changelog-row-num">{i + 1}</span>
									<span>{change.description}</span>
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Footer with progress + actions -->
		<div class="flex items-center justify-between p-5 px-8 mt-auto border-t border-border/30">
			<div class="flex items-center gap-3">
				<!-- Segmented progress showing change count -->
				{#if totalChanges > 0}
					<SegmentedProgress
						current={totalChanges}
						total={totalChanges}
						filledClass="opacity-100"
						emptyClass="bg-border/55 h-[5px] opacity-[0.55]"
					/>
					<span class="text-[10px] text-muted-foreground/40 font-mono tabular-nums">
						{totalChanges} changes
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<PillButton variant="ghost" size="sm" onclick={onSkip}>
					{m.update_available_skip()}
				</PillButton>
				<PillButton variant="primary" size="md" onclick={onInstall}>
					{#snippet trailingIcon()}
						<ArrowRightIcon size="lg" />
					{/snippet}
					{m.update_available_install()}
				</PillButton>
			</div>
		</div>
	</div>
</div>

<style>
	.update-available-card {
		border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.08),
			0 20px 60px rgba(0, 0, 0, 0.35);
		animation: card-enter 0.4s ease-out;
	}

	@keyframes card-enter {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.changelog-group {
		border-radius: 0.625rem;
		overflow: hidden;
		background: color-mix(in srgb, var(--input) 25%, transparent);
	}

	.changelog-group-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.3rem 0.625rem;
		font-size: 0.625rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--muted) 25%, transparent);
	}

	.changelog-group-row {
		display: grid;
		grid-template-columns: 1rem 1fr;
		align-items: baseline;
		gap: 0.375rem;
		padding: 0.35rem 0.625rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--foreground);
	}

	.changelog-group-row:hover {
		background: color-mix(in srgb, var(--muted) 12%, transparent);
	}

	.changelog-row-num {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		opacity: 0.4;
	}
</style>
