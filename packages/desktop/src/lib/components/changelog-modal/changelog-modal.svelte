<script lang="ts">
import {
	GrainGradientShapes,
	type GrainGradientUniforms,
	getShaderColorFromString,
	getShaderNoiseTexture,
	grainGradientFragmentShader,
	ShaderFitOptions,
	ShaderMount,
} from "@paper-design/shaders";
import { Bug } from "phosphor-svelte";
import { Lightning } from "phosphor-svelte";
import { NumberCircleEight } from "phosphor-svelte";
import { NumberCircleFive } from "phosphor-svelte";
import { NumberCircleFour } from "phosphor-svelte";
import { NumberCircleNine } from "phosphor-svelte";
import { NumberCircleOne } from "phosphor-svelte";
import { NumberCircleSeven } from "phosphor-svelte";
import { NumberCircleSix } from "phosphor-svelte";
import { NumberCircleThree } from "phosphor-svelte";
import { NumberCircleTwo } from "phosphor-svelte";
import { RocketLaunch } from "phosphor-svelte";
import { Warning } from "phosphor-svelte";
import { X } from "phosphor-svelte";
import { BRAND_SHADER_DARK_PALETTE, type BrandShaderColorTuple } from "@acepe/ui";
import { type Component, onDestroy, onMount } from "svelte";
import { Colors } from "$lib/acp/utils/colors.js";
import type { ChangelogEntry, ChangeType } from "$lib/changelog/index.js";
import { groupChangesByType } from "$lib/changelog/index.js";
import type { Theme } from "$lib/components/theme/context.svelte.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import * as m from "$lib/messages.js";

const numberIcons: Component[] = [
	NumberCircleOne,
	NumberCircleTwo,
	NumberCircleThree,
	NumberCircleFour,
	NumberCircleFive,
	NumberCircleSix,
	NumberCircleSeven,
	NumberCircleEight,
	NumberCircleNine,
];

interface Props {
	entries: ChangelogEntry[];
	onDismiss: () => void;
}

let { entries, onDismiss }: Props = $props();

let shaderContainer: HTMLDivElement | null = $state(null);
let shaderMountRef: ShaderMount | null = null;
let shaderInitVersion = 0;

type EffectiveTheme = Exclude<Theme, "system">;
type ChangelogThemePalette = {
	surface: string;
	border: string;
	heroBackground: string;
	heroForeground: string;
	heroOverlayTop: string;
	heroOverlayMiddle: string;
	heroOverlayBottom: string;
	closeButtonBackground: string;
	closeButtonHoverBackground: string;
	closeButtonForeground: string;
	shaderBackground: string;
	shaderColors: BrandShaderColorTuple;
};

const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);

const changelogThemePalettes: Record<EffectiveTheme, ChangelogThemePalette> = {
	dark: {
		surface: "#101010",
		border: "rgba(255, 255, 255, 0.08)",
		heroBackground: "#1a1a1a",
		heroForeground: "#f5f0ea",
		heroOverlayTop: "rgba(255, 255, 255, 0)",
		heroOverlayMiddle: "rgba(0, 0, 0, 0.10)",
		heroOverlayBottom: "rgba(0, 0, 0, 0.60)",
		closeButtonBackground: "rgba(255, 255, 255, 0.10)",
		closeButtonHoverBackground: "rgba(255, 255, 255, 0.18)",
		closeButtonForeground: "#f5f0ea",
		shaderBackground: BRAND_SHADER_DARK_PALETTE.background,
		shaderColors: BRAND_SHADER_DARK_PALETTE.colors,
	},
	light: {
		surface: "#fcfbf7",
		border: "rgba(47, 36, 25, 0.10)",
		heroBackground: "#fff2e2",
		heroForeground: "#2f2419",
		heroOverlayTop: "rgba(255, 255, 255, 0.20)",
		heroOverlayMiddle: "rgba(255, 244, 232, 0.18)",
		heroOverlayBottom: "rgba(255, 255, 255, 0.72)",
		closeButtonBackground: "rgba(47, 36, 25, 0.06)",
		closeButtonHoverBackground: "rgba(47, 36, 25, 0.12)",
		closeButtonForeground: "#2f2419",
		shaderBackground: "#fae2c3",
		shaderColors: ["#F77E2C", "#ffb574", "#ffd7aa", "#fff1de"],
	},
};

const themePalette = $derived(changelogThemePalettes[effectiveTheme]);
const modalThemeStyle = $derived.by(() =>
	[
		`--changelog-surface: ${themePalette.surface}`,
		`--changelog-border: ${themePalette.border}`,
		`--changelog-hero-background: ${themePalette.heroBackground}`,
		`--changelog-hero-foreground: ${themePalette.heroForeground}`,
		`--changelog-hero-overlay-top: ${themePalette.heroOverlayTop}`,
		`--changelog-hero-overlay-middle: ${themePalette.heroOverlayMiddle}`,
		`--changelog-hero-overlay-bottom: ${themePalette.heroOverlayBottom}`,
		`--changelog-close-background: ${themePalette.closeButtonBackground}`,
		`--changelog-close-hover-background: ${themePalette.closeButtonHoverBackground}`,
		`--changelog-close-foreground: ${themePalette.closeButtonForeground}`,
	].join("; ")
);

const changeTypeConfig: Record<ChangeType, { icon: Component; hex: string; label: string }> = {
	feature: { icon: RocketLaunch, hex: "var(--success)", label: "Features" },
	fix: { icon: Bug, hex: Colors.red, label: "Fixes" },
	improvement: { icon: Lightning, hex: Colors.orange, label: "Improvements" },
	breaking: { icon: Warning, hex: Colors.red, label: "Breaking" },
};

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "Escape" || event.key === "Enter") {
		event.preventDefault();
		onDismiss();
	}
}

onMount(() => {
	window.addEventListener("keydown", handleKeydown);
});

$effect(() => {
	if (!shaderContainer) {
		return;
	}

	const initVersion = ++shaderInitVersion;
	shaderMountRef?.dispose();
	shaderMountRef = null;
	void initShader(themePalette, initVersion);

	return () => {
		if (shaderInitVersion === initVersion) {
			shaderMountRef?.dispose();
			shaderMountRef = null;
		}
	};
});

async function initShader(palette: ChangelogThemePalette, initVersion: number) {
	if (!shaderContainer) return;

	try {
		const noiseTexture = getShaderNoiseTexture();

		if (noiseTexture && !noiseTexture.complete) {
			await new Promise<void>((resolve, reject) => {
				noiseTexture.onload = () => resolve();
				noiseTexture.onerror = () => reject(new Error("Failed to load noise texture"));
			});
		}

		const containerWidth = shaderContainer.offsetWidth;
		const containerHeight = shaderContainer.offsetHeight;
		if (initVersion !== shaderInitVersion) return;

		shaderMountRef = new ShaderMount(
			shaderContainer,
			grainGradientFragmentShader,
			{
				u_colorBack: getShaderColorFromString(palette.shaderBackground),
				u_colors: palette.shaderColors.map((color) => getShaderColorFromString(color)),
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
	} catch (error) {
		console.error("[ChangelogModal] Failed to initialize shader:", error);
	}
}

onDestroy(() => {
	window.removeEventListener("keydown", handleKeydown);
	shaderMountRef?.dispose();
});
</script>

<div
	class="fixed inset-0 z-[var(--app-elevated-z)] flex items-center justify-center"
	role="dialog"
	aria-modal="true"
	aria-label={m.changelog_title()}
>
	<!-- Backdrop -->
	<button
		type="button"
		class="absolute inset-0 w-full h-full bg-black/60 cursor-default border-0 p-0 appearance-none"
		onclick={onDismiss}
		aria-label={m.common_close()}
	></button>

	<!-- Modal -->
	<div
		class="changelog-modal-panel relative z-10 flex flex-col w-[560px] max-h-[85vh] rounded-3xl overflow-hidden shadow-2xl"
		style={modalThemeStyle}
	>
		<!-- Hero: Shader background -->
		<div class="relative h-44 shrink-0 flex items-center justify-center">
			<div bind:this={shaderContainer} class="changelog-hero-shader absolute inset-0"></div>
			<div class="changelog-hero-overlay absolute inset-0"></div>
			<h1 class="changelog-hero-title relative z-10 text-3xl font-semibold">
				{m.changelog_hero_title()}
			</h1>
			<!-- Close button -->
			<button
				type="button"
				onclick={onDismiss}
				class="changelog-close-button absolute top-4 right-4 z-20 flex items-center justify-center size-8 rounded-full transition-colors"
				aria-label="Close"
			>
				<X weight="bold" class="size-3.5" />
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto px-8 pt-6 pb-7">
			{#each entries as entry, entryIndex (entry.version)}
				{@const groups = groupChangesByType(entry.changes)}

				<!-- Divider between entries -->
				{#if entryIndex > 0}
					<div class="my-6 border-t border-border"></div>
				{/if}

				<div class="text-center">
					<div
						class="inline-flex items-center gap-2 rounded-full bg-foreground/5 px-3 py-1 text-[11px] font-medium text-muted-foreground"
					>
						{formatDate(entry.date)}
					</div>
					<h2 class="mt-4 text-2xl font-semibold text-foreground">
						{#if entries.length === 1}
							{m.changelog_title()} v{entry.version}
						{:else}
							v{entry.version}
						{/if}
					</h2>
					{#if entry.highlights}
						<p class="mt-2 text-sm text-muted-foreground">{entry.highlights}</p>
					{/if}
				</div>

				<!-- Changes by category -->
				<div class="mt-6 flex flex-col gap-3 text-left">
					{#each groups as group (group.type)}
						{@const config = changeTypeConfig[group.type]}
						{@const SectionIcon = config.icon}

						<div class="changelog-table">
							<div class="changelog-table-header">
								<SectionIcon weight="fill" class="size-3" style="color: {config.hex}" />
								<span>{config.label}</span>
							</div>

							{#each group.items as change, i (`${entry.version}-${group.type}-${i}`)}
								<div class="changelog-table-row">
									{#if i < numberIcons.length}
										{@const NumIcon = numberIcons[i]}
										<span class="changelog-row-num"><NumIcon weight="fill" class="size-4" /></span>
									{:else}
										<span class="changelog-row-num">{i + 1}</span>
									{/if}
									<span>{change.description}</span>
								</div>
							{/each}
						</div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.changelog-modal-panel {
		background: var(--changelog-surface);
		border: 1px solid var(--changelog-border);
	}

	.changelog-hero-shader {
		background: var(--changelog-hero-background);
	}

	.changelog-hero-overlay {
		background: linear-gradient(
			to bottom,
			var(--changelog-hero-overlay-top),
			var(--changelog-hero-overlay-middle),
			var(--changelog-hero-overlay-bottom)
		);
	}

	.changelog-hero-title {
		color: var(--changelog-hero-foreground);
	}

	.changelog-close-button {
		background: var(--changelog-close-background);
		color: var(--changelog-close-foreground);
	}

	.changelog-close-button:hover {
		background: var(--changelog-close-hover-background);
	}

	.changelog-table {
		border-radius: 0.75rem;
		overflow: hidden;
		background: color-mix(in srgb, var(--input) 30%, transparent);
	}

	.changelog-table-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--muted) 30%, transparent);
	}

	.changelog-table-row {
		display: grid;
		grid-template-columns: 1rem 1fr;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.45rem 0.75rem;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--foreground);
	}

	.changelog-table-row:hover {
		background: color-mix(in srgb, var(--muted) 15%, transparent);
	}

	.changelog-row-num {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--muted-foreground);
		opacity: 0.5;
	}
</style>
