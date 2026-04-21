<script lang="ts">
import { onDestroy, onMount } from "svelte";
import {
	GrainGradientShapes,
	ShaderFitOptions,
	ShaderMount,
	getShaderColorFromString,
	getShaderNoiseTexture,
	grainGradientFragmentShader,
	pulsingBorderFragmentShader,
	type GrainGradientUniforms,
	type PulsingBorderUniforms,
} from "@paper-design/shaders";
import { websiteThemeStore } from "$lib/theme/theme.js";

interface Props {
	class?: string;
	/** Height of the shader stage. Height-based so the hero composition stays stable. */
	heightClass?: string;
	/** When true, renders a second shader (pulsing border) for a luminous accent ring. */
	accentRing?: boolean;
}

let {
	class: className = "",
	heightClass = "h-[min(900px,100vh)]",
	accentRing = false,
}: Props = $props();

const theme = $derived($websiteThemeStore);

let primaryContainer: HTMLDivElement | null = $state(null);
let accentContainer: HTMLDivElement | null = $state(null);
let shaderReady = $state(false);
let primaryMount: ShaderMount | null = null;
let accentMount: ShaderMount | null = null;
let initVersion = 0;

type PaletteKind = "dark" | "light";

function paletteFor(kind: PaletteKind) {
	if (kind === "light") {
		return {
			background: "#F0EEE6",
			colors: ["#F77E2C", "#F9A15E", "#FFD7A8", "#FFE7CA"] as const,
			softness: 0.36,
			intensity: 0.92,
			noise: 0.14,
		};
	}

	return {
		background: "#0F0F10",
		colors: ["#F77E2C", "#C85A12", "#5B2404", "#18120E"] as const,
		softness: 0.6,
		intensity: 0.92,
		noise: 0.18,
	};
}

onMount(() => {
	initVersion += 1;
	void init(initVersion);
});

onDestroy(() => {
	initVersion += 1;
	primaryMount?.dispose();
	accentMount?.dispose();
	primaryMount = null;
	accentMount = null;
});

async function init(version: number) {
	if (!primaryContainer) return;

	const noiseTexture = getShaderNoiseTexture();
	if (noiseTexture && !noiseTexture.complete) {
		await new Promise<void>((resolve, reject) => {
			noiseTexture.onload = () => resolve();
			noiseTexture.onerror = () => reject(new Error("Failed to load noise texture"));
		});
	}

	if (version !== initVersion) return;

	const activeTheme: PaletteKind = theme === "light" ? "light" : "dark";
	const palette = paletteFor(activeTheme);

	primaryMount = new ShaderMount(
		primaryContainer,
		grainGradientFragmentShader,
		{
			u_colorBack: getShaderColorFromString(palette.background),
			u_colors: [
				getShaderColorFromString(palette.colors[0]),
				getShaderColorFromString(palette.colors[1]),
				getShaderColorFromString(palette.colors[2]),
				getShaderColorFromString(palette.colors[3]),
			],
			u_colorsCount: 4,
			u_softness: palette.softness,
			u_intensity: palette.intensity,
			u_noise: palette.noise,
			u_shape: GrainGradientShapes.corners,
			u_noiseTexture: noiseTexture,
			u_fit: ShaderFitOptions.cover,
			u_scale: 1.25,
			u_rotation: 0,
			u_originX: 0.5,
			u_originY: 0.5,
			u_offsetX: 0,
			u_offsetY: 0,
			u_worldWidth: primaryContainer.offsetWidth,
			u_worldHeight: primaryContainer.offsetHeight,
		} satisfies Partial<GrainGradientUniforms>,
		{ alpha: false, premultipliedAlpha: false },
		0.35
	);

	if (accentRing && accentContainer) {
		accentMount = new ShaderMount(
			accentContainer,
			pulsingBorderFragmentShader,
			{
				u_colorBack: getShaderColorFromString("#00000000"),
				u_colors: [
					getShaderColorFromString("#F77E2C"),
					getShaderColorFromString("#FFB27A"),
					getShaderColorFromString("#FF6A1A"),
				],
				u_colorsCount: 3,
				u_roundness: 1,
				u_thickness: 0.18,
				u_softness: 0.85,
				u_marginLeft: 0.08,
				u_marginRight: 0.08,
				u_marginTop: 0.2,
				u_marginBottom: 0.2,
				u_aspectRatio: 0,
				u_intensity: 0.55,
				u_bloom: 0.85,
				u_spots: 4,
				u_spotSize: 0.35,
				u_pulse: 0.35,
				u_smoke: 0.25,
				u_smokeSize: 0.6,
				u_noiseTexture: noiseTexture,
				u_fit: ShaderFitOptions.cover,
				u_scale: 1,
				u_rotation: 0,
				u_originX: 0.5,
				u_originY: 0.5,
				u_offsetX: 0,
				u_offsetY: 0,
				u_worldWidth: accentContainer.offsetWidth,
				u_worldHeight: accentContainer.offsetHeight,
			} satisfies Partial<PulsingBorderUniforms>,
			{ alpha: true, premultipliedAlpha: false },
			0.2
		);
	}

	if (version !== initVersion) {
		primaryMount?.dispose();
		accentMount?.dispose();
		primaryMount = null;
		accentMount = null;
		return;
	}

	shaderReady = true;
}
</script>

<div
	class="hero-shader-stage pointer-events-none absolute inset-x-0 top-0 overflow-hidden {heightClass} {className}"
	aria-hidden="true"
>
	<div
		bind:this={primaryContainer}
		class="absolute inset-0 block h-full w-full transition-opacity duration-[1400ms] ease-out {shaderReady
			? 'opacity-100'
			: 'opacity-0'}"
	></div>

	{#if accentRing}
		<div
			bind:this={accentContainer}
			class="absolute inset-0 block h-full w-full mix-blend-screen transition-opacity duration-[1800ms] ease-out {shaderReady
				? 'opacity-60'
				: 'opacity-0'}"
		></div>
	{/if}

	<!-- Subtle grain film -->
	<div class="absolute inset-0 grain-film opacity-[0.14]"></div>

	<!-- Vignette: darkens the edges so the hero content floats -->
	<div class="absolute inset-0 vignette"></div>

	<!-- Top gradient: keeps the floating header readable over warm tones -->
	<div class="absolute inset-x-0 top-0 h-40 top-fade"></div>

	<!-- Bottom fade to page bg: stitches shader into the page content seamlessly -->
	<div class="absolute inset-x-0 bottom-0 h-48 bottom-fade"></div>
</div>

<style>
	.hero-shader-stage :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.vignette {
		background:
			radial-gradient(
				120% 80% at 50% 50%,
				transparent 0%,
				transparent 55%,
				color-mix(in srgb, var(--background) 35%, transparent) 82%,
				color-mix(in srgb, var(--background) 75%, transparent) 100%
			);
	}

	.top-fade {
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--background) 38%, transparent) 0%,
			transparent 100%
		);
	}

	.bottom-fade {
		background: linear-gradient(
			to bottom,
			transparent 0%,
			color-mix(in srgb, var(--background) 35%, transparent) 55%,
			color-mix(in srgb, var(--background) 85%, transparent) 85%,
			var(--background) 100%
		);
	}

	.grain-film {
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
		mix-blend-mode: overlay;
	}
</style>
