<script lang="ts">
import { onDestroy, onMount } from "svelte";
import {
	ShaderFitOptions,
	ShaderMount,
	getShaderColorFromString,
	getShaderNoiseTexture,
	meshGradientFragmentShader,
	pulsingBorderFragmentShader,
	type MeshGradientUniforms,
	type PulsingBorderUniforms,
} from "@paper-design/shaders";
import { websiteThemeStore } from "$lib/theme/theme.js";

interface Props {
	class?: string;
	heightClass?: string;
}

let { class: className = "", heightClass = "h-full" }: Props = $props();

const theme = $derived($websiteThemeStore);

let baseContainer: HTMLDivElement | null = $state(null);
let ringContainer: HTMLDivElement | null = $state(null);
let baseMount: ShaderMount | null = null;
let ringMount: ShaderMount | null = null;
let ready = $state(false);
let initVersion = 0;

type PaletteKind = "dark" | "light";

interface Palette {
	background: string;
	colors: [string, string, string, string];
	ring: [string, string, string];
}

function paletteFor(kind: PaletteKind): Palette {
	if (kind === "light") {
		return {
			background: "#F0EEE6",
			colors: ["#E0DAC8", "#A8C8C8", "#D4C898", "#F2EAD2"],
			ring: ["#0F1E1F", "#1B3A3D", "#2C5A5E"],
		};
	}
	return {
		background: "#0A0B0D",
		colors: ["#101820", "#1F4A4D", "#2D6F6A", "#0E1517"],
		ring: ["#E8FAF5", "#7FD7C6", "#3D8276"],
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
	baseMount?.dispose();
	ringMount?.dispose();
	baseMount = null;
	ringMount = null;
}

let lastSig = "";
const sig = $derived(`${theme}`);

$effect(() => {
	if (!baseContainer) return;
	if (sig === lastSig) return;
	lastSig = sig;
	initVersion += 1;
	teardown();
	ready = false;
	void init(initVersion);
});

async function init(version: number) {
	if (!baseContainer) return;

	const noiseTexture = getShaderNoiseTexture();
	if (noiseTexture && !noiseTexture.complete) {
		await new Promise<void>((resolve, reject) => {
			noiseTexture.onload = () => resolve();
			noiseTexture.onerror = () => reject(new Error("Failed to load noise texture"));
		});
	}

	if (version !== initVersion) return;

	const kind: PaletteKind = theme === "light" ? "light" : "dark";
	const palette = paletteFor(kind);

	const baseUniforms: Partial<MeshGradientUniforms> = {
		u_colors: palette.colors.map((c) => getShaderColorFromString(c)),
		u_colorsCount: 4,
		u_distortion: 0.85,
		u_swirl: 0.55,
		u_grainMixer: 0.38,
		u_grainOverlay: 0.22,
		u_fit: ShaderFitOptions.cover,
		u_scale: 1.25,
		u_rotation: 0,
		u_originX: 0.5,
		u_originY: 0.5,
		u_offsetX: 0,
		u_offsetY: 0,
		u_worldWidth: baseContainer.offsetWidth,
		u_worldHeight: baseContainer.offsetHeight,
	};

	baseMount = new ShaderMount(
		baseContainer,
		meshGradientFragmentShader,
		baseUniforms,
		{ alpha: false, premultipliedAlpha: false },
		0.18,
	);

	if (ringContainer) {
		const ringUniforms: Partial<PulsingBorderUniforms> = {
			u_colorBack: getShaderColorFromString("#00000000"),
			u_colors: palette.ring.map((c) => getShaderColorFromString(c)),
			u_colorsCount: 3,
			u_roundness: 1,
			u_thickness: 0.12,
			u_softness: 0.95,
			u_marginLeft: 0.04,
			u_marginRight: 0.04,
			u_marginTop: 0.08,
			u_marginBottom: 0.08,
			u_aspectRatio: 0,
			u_intensity: 0.45,
			u_bloom: 0.7,
			u_spots: 5,
			u_spotSize: 0.42,
			u_pulse: 0.22,
			u_smoke: 0.28,
			u_smokeSize: 0.7,
			u_noiseTexture: noiseTexture,
			u_fit: ShaderFitOptions.cover,
			u_scale: 1,
			u_rotation: 0,
			u_originX: 0.5,
			u_originY: 0.5,
			u_offsetX: 0,
			u_offsetY: 0,
			u_worldWidth: ringContainer.offsetWidth,
			u_worldHeight: ringContainer.offsetHeight,
		};

		ringMount = new ShaderMount(
			ringContainer,
			pulsingBorderFragmentShader,
			ringUniforms,
			{ alpha: true, premultipliedAlpha: false },
			0.14,
		);
	}

	if (version !== initVersion) {
		teardown();
		return;
	}

	ready = true;
}
</script>

<div
	class="zeus-shader-stage pointer-events-none absolute inset-x-0 top-0 overflow-hidden {heightClass} {className}"
	aria-hidden="true"
>
	<div
		bind:this={baseContainer}
		class="absolute inset-0 block h-full w-full {ready
			? 'opacity-100'
			: 'opacity-0'}"
	></div>

	<div
		bind:this={ringContainer}
		class="absolute inset-x-0 top-0 block h-[calc(100%+40px)] w-full mix-blend-screen {ready
			? 'opacity-70'
			: 'opacity-0'}"
	></div>

	<div class="absolute inset-0 grain-film opacity-[0.12]"></div>
	<div class="absolute inset-0 vignette"></div>
	<div class="absolute inset-x-0 top-0 h-32 top-fade"></div>
	<div class="absolute inset-x-0 bottom-0 h-56 bottom-fade"></div>
</div>

<style>
	.zeus-shader-stage :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.vignette {
		background:
			radial-gradient(
				130% 90% at 50% 50%,
				transparent 0%,
				transparent 65%,
				color-mix(in srgb, var(--background) 30%, transparent) 85%,
				color-mix(in srgb, var(--background) 75%, transparent) 100%
			);
	}

	.top-fade {
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--background) 42%, transparent) 0%,
			transparent 100%
		);
	}

	.bottom-fade {
		background: linear-gradient(
			to bottom,
			transparent 0%,
			color-mix(in srgb, var(--background) 35%, transparent) 50%,
			color-mix(in srgb, var(--background) 85%, transparent) 82%,
			var(--background) 100%
		);
	}

	.grain-film {
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
		mix-blend-mode: overlay;
	}
</style>
