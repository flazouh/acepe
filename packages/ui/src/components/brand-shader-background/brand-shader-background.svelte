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
import { onDestroy, onMount } from "svelte";

import { cn } from "../../lib/utils";
import {
	BRAND_SHADER_DARK_PALETTE,
	BRAND_SHADER_LUMINAR_PALETTE,
	type BrandShaderPalette,
} from "../../lib/brand-shader-palette.js";

type BrandShaderFallback = "solid" | "gradient";
type BrandShaderVariant = "acepe" | "luminar";

interface Props {
	class?: string;
	fallback?: BrandShaderFallback;
	variant?: BrandShaderVariant;
}

let {
	class: className,
	fallback = "solid",
	variant = "acepe",
}: Props = $props();

let container: HTMLDivElement | null = $state(null);
let shaderReady = $state(false);
let shaderInitVersion = 0;
let shaderMountRef: ShaderMount | null = null;

const palette = $derived.by<BrandShaderPalette>(() => {
	if (variant === "luminar") {
		return BRAND_SHADER_LUMINAR_PALETTE;
	}

	return BRAND_SHADER_DARK_PALETTE;
});

const backgroundStyle = $derived(`background: ${palette.background};`);
const fallbackStyle = $derived.by(() => {
	if (fallback === "gradient") {
		return `background: linear-gradient(135deg, ${palette.colors[0]}, ${palette.background});`;
	}

	return `background: ${palette.background};`;
});

onMount(() => {
	if (!container) {
		return;
	}

	const initVersion = shaderInitVersion + 1;
	shaderInitVersion = initVersion;
	shaderReady = false;
	void initShader(container, initVersion).catch((error: Error) => {
		if (initVersion !== shaderInitVersion) {
			return;
		}

		console.error("[BrandShaderBackground] Failed to initialize shader:", error);
	});
});

onDestroy(() => {
	shaderInitVersion += 1;
	shaderMountRef?.dispose();
	shaderMountRef = null;
});

async function initShader(node: HTMLDivElement, initVersion: number) {
	const noiseTexture = getShaderNoiseTexture();

	if (noiseTexture && !noiseTexture.complete) {
		await new Promise<void>((resolve, reject) => {
			noiseTexture.onload = () => resolve();
			noiseTexture.onerror = () => reject(new Error("Failed to load shader noise texture"));
		});
	}

	if (initVersion !== shaderInitVersion) {
		return;
	}

	shaderMountRef = new ShaderMount(
		node,
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
			u_scale: 1,
			u_rotation: 0,
			u_originX: 0.5,
			u_originY: 0.5,
			u_offsetX: 0,
			u_offsetY: 0,
			u_worldWidth: node.offsetWidth,
			u_worldHeight: node.offsetHeight,
		} satisfies Partial<GrainGradientUniforms>,
		{ alpha: false, premultipliedAlpha: false },
		0.5
	);

	if (initVersion !== shaderInitVersion) {
		shaderMountRef.dispose();
		shaderMountRef = null;
		return;
	}

	shaderReady = true;
}
</script>

<div class={cn("absolute inset-0 overflow-hidden", className)} style={backgroundStyle}>
	<div
		bind:this={container}
		class={cn(
			"absolute inset-0 block h-full w-full transition-opacity duration-1000",
			shaderReady ? "opacity-100" : "opacity-0"
		)}
	></div>

	{#if !shaderReady}
		<div class="absolute inset-0" style={fallbackStyle}></div>
	{/if}
</div>

<style>
	div :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
