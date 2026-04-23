<script lang="ts">
import { onDestroy, onMount } from "svelte";
import {
	ShaderFitOptions,
	ShaderMount,
	getShaderColorFromString,
	getShaderNoiseTexture,
	pulsingBorderFragmentShader,
	type PulsingBorderUniforms,
} from "@paper-design/shaders";
import { websiteThemeStore } from "$lib/theme/theme.js";
import {
	DEFAULT_DARK_PALETTE,
	DEFAULT_LIGHT_PALETTE,
	shaderPrefsStore,
	type ShaderPalette,
} from "$lib/dev/shader-preference-store.js";
import { buildShader } from "$lib/dev/shader-options.js";

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
const prefs = $derived($shaderPrefsStore);
const shaderKind = $derived(prefs.kind);
const shaderSpeed = $derived(prefs.speed);
const shaderParams = $derived(prefs.params[prefs.kind] ?? {});
const paletteOverride = $derived(prefs.paletteOverride);

let primaryContainer: HTMLDivElement | null = $state(null);
let accentContainer: HTMLDivElement | null = $state(null);
let shaderReady = $state(false);
let primaryMount: ShaderMount | null = null;
let accentMount: ShaderMount | null = null;
let initVersion = 0;
let lastSignature = "";

type PaletteKind = "dark" | "light";

function themePalette(kind: PaletteKind): ShaderPalette {
	if (kind === "light") {
		return {
			background: DEFAULT_LIGHT_PALETTE.background,
			colors: [
				DEFAULT_LIGHT_PALETTE.colors[0],
				DEFAULT_LIGHT_PALETTE.colors[1],
				DEFAULT_LIGHT_PALETTE.colors[2],
				DEFAULT_LIGHT_PALETTE.colors[3],
			],
		};
	}
	return {
		background: DEFAULT_DARK_PALETTE.background,
		colors: [
			DEFAULT_DARK_PALETTE.colors[0],
			DEFAULT_DARK_PALETTE.colors[1],
			DEFAULT_DARK_PALETTE.colors[2],
			DEFAULT_DARK_PALETTE.colors[3],
		],
	};
}

onMount(() => {
	initVersion += 1;
	void init(initVersion);
});

onDestroy(() => {
	initVersion += 1;
	teardown();
});

function teardown() {
	primaryMount?.dispose();
	accentMount?.dispose();
	primaryMount = null;
	accentMount = null;
}

const signature = $derived(
	`${theme}|${shaderKind}|${accentRing}|${shaderSpeed}|${paletteOverride ? `${paletteOverride.background}:${paletteOverride.colors.join(",")}` : "theme"}|${JSON.stringify(shaderParams)}`
);

$effect(() => {
	// Guarded re-init when theme or selected shader changes.
	if (!primaryContainer) return;
	if (signature === lastSignature) return;
	lastSignature = signature;
	initVersion += 1;
	teardown();
	shaderReady = false;
	void init(initVersion);
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
	const palette = paletteOverride ?? themePalette(activeTheme);

	const option = buildShader(
		shaderKind,
		palette,
		shaderParams,
		shaderSpeed,
		primaryContainer.offsetWidth,
		primaryContainer.offsetHeight,
		noiseTexture ?? null
	);

	primaryMount = new ShaderMount(
		primaryContainer,
		option.fragment,
		option.uniforms,
		option.webgl,
		option.speed
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
		teardown();
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
		class="absolute inset-x-0 top-0 block h-[calc(100%+60px)] w-full transition-opacity duration-[1400ms] ease-out {shaderReady
			? 'opacity-100'
			: 'opacity-0'}"
	></div>

	{#if accentRing}
		<div
			bind:this={accentContainer}
			class="absolute inset-x-0 top-0 block h-[calc(100%+60px)] w-full mix-blend-screen transition-opacity duration-[1800ms] ease-out {shaderReady
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
