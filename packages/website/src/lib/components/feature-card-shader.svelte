<script lang="ts">
import { onDestroy, onMount } from "svelte";
import {
	GrainGradientShapes,
	ShaderFitOptions,
	ShaderMount,
	getShaderColorFromString,
	getShaderNoiseTexture,
	grainGradientFragmentShader,
	type GrainGradientUniforms,
} from "@paper-design/shaders";

import { DEFAULT_DARK_PALETTE } from "$lib/dev/shader-preference-store.js";

let host: HTMLDivElement | null = $state(null);
let shaderContainer: HTMLDivElement | null = $state(null);
let shaderReady = $state(false);
let observer: IntersectionObserver | null = null;
let mount: ShaderMount | null = null;
let initVersion = 0;

onMount(() => {
	if (!host) return;

	if (!("IntersectionObserver" in window)) {
		initVersion += 1;
		void init(initVersion);
		return;
	}

	observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					initVersion += 1;
					void init(initVersion);
				} else {
					initVersion += 1;
					teardown();
				}
			}
		},
		{ rootMargin: "120px 0px" }
	);

	observer.observe(host);
});

onDestroy(() => {
	observer?.disconnect();
	initVersion += 1;
	teardown();
});

function teardown() {
	mount?.dispose();
	mount = null;
	shaderReady = false;
}

async function init(version: number) {
	if (!shaderContainer || mount) return;

	const noiseTexture = getShaderNoiseTexture();
	if (noiseTexture && !noiseTexture.complete) {
		await waitForImageLoad(noiseTexture);
	}

	if (version !== initVersion || !shaderContainer) return;

	const w = shaderContainer.offsetWidth;
	const h = shaderContainer.offsetHeight;

	mount = new ShaderMount(
		shaderContainer,
		grainGradientFragmentShader,
		{
			u_colorBack: getShaderColorFromString(DEFAULT_DARK_PALETTE.background),
			u_colors: [
				getShaderColorFromString(DEFAULT_DARK_PALETTE.colors[0]),
				getShaderColorFromString(DEFAULT_DARK_PALETTE.colors[1]),
				getShaderColorFromString(DEFAULT_DARK_PALETTE.colors[2]),
				getShaderColorFromString(DEFAULT_DARK_PALETTE.colors[3]),
			],
			u_colorsCount: 4,
			u_softness: 0.6,
			u_intensity: 0.14,
			u_noise: 0.56,
			u_shape: GrainGradientShapes.wave,
			u_noiseTexture: noiseTexture,
			u_fit: ShaderFitOptions.cover,
			u_scale: 1.25,
			u_rotation: 0,
			u_originX: 0.5,
			u_originY: 0.5,
			u_offsetX: 0,
			u_offsetY: 0,
			u_worldWidth: w,
			u_worldHeight: h,
		} satisfies Partial<GrainGradientUniforms>,
		{ alpha: false, premultipliedAlpha: false },
		0.35
	);

	if (version !== initVersion) {
		teardown();
		return;
	}

	shaderReady = true;
}

function waitForImageLoad(image: HTMLImageElement): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onLoad = () => {
			image.removeEventListener("error", onError);
			resolve();
		};
		const onError = () => {
			image.removeEventListener("load", onLoad);
			reject(new Error("Feature card shader noise texture failed to load"));
		};

		image.addEventListener("load", onLoad, { once: true });
		image.addEventListener("error", onError, { once: true });
	});
}
</script>

<div bind:this={host} class="absolute inset-0 overflow-hidden bg-[#0F0F10]" aria-hidden="true">
	<div
		bind:this={shaderContainer}
		class="absolute inset-0 transition-opacity duration-700 {shaderReady ? 'opacity-100' : 'opacity-0'}"
	></div>
</div>

<style>
	div :global(canvas) {
		display: block;
		height: 100%;
		width: 100%;
	}
</style>
