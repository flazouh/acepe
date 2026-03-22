<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		ShaderMount,
		grainGradientFragmentShader,
		getShaderColorFromString,
		getShaderNoiseTexture,
		GrainGradientShapes,
		ShaderFitOptions,
		type GrainGradientUniforms
	} from '@paper-design/shaders';

	let container: HTMLDivElement | undefined = $state();
	let isMounted = $state(false);
	let shaderMountRef: ShaderMount | null = null;

	onMount(() => {
		isMounted = true;
		initShader();
	});

	async function initShader() {
		if (!container) return;
		const isLightTheme = document.documentElement.dataset.theme === 'light';
		const backgroundColor = isLightTheme ? '#F0EEE6' : '#1a1a1a';
		const gradientColors = isLightTheme
			? ['#f77e2c', '#f9a15e', '#f8c890', '#fde7d1']
			: ['#ff8558', '#F77E2C', '#d69d5c', '#ffb380'];

		const noiseTexture = getShaderNoiseTexture();

		// Wait for the noise texture image to load
		if (noiseTexture && !noiseTexture.complete) {
			await new Promise<void>((resolve, reject) => {
				noiseTexture.onload = () => resolve();
				noiseTexture.onerror = () => reject(new Error('Failed to load noise texture'));
			});
		}

		const containerWidth = container.offsetWidth;
		const containerHeight = container.offsetHeight;

		shaderMountRef = new ShaderMount(
			container,
			grainGradientFragmentShader,
			{
				// Colors (matching desktop splash screen)
				u_colorBack: getShaderColorFromString(backgroundColor),
				u_colors: gradientColors.map((color) => getShaderColorFromString(color)),
				u_colorsCount: 4,
				// Effect parameters
				u_softness: 0.3,
				u_intensity: 0.8,
				u_noise: 0.15,
				u_shape: GrainGradientShapes.corners,
				u_noiseTexture: noiseTexture,
				// Sizing uniforms
				u_fit: ShaderFitOptions.cover,
				u_scale: 1,
				u_rotation: 0,
				u_originX: 0.5,
				u_originY: 0.5,
				u_offsetX: 0,
				u_offsetY: 0,
				u_worldWidth: containerWidth,
				u_worldHeight: containerHeight
			} satisfies Partial<GrainGradientUniforms>,
			{ alpha: false, premultipliedAlpha: false },
			0.5
		);
	}

	onDestroy(() => {
		shaderMountRef?.dispose();
	});
</script>

<div class="absolute inset-0 overflow-hidden" style="background-color: var(--background);">
	<div
		bind:this={container}
		class="absolute inset-0 block h-full w-full transition-opacity duration-1000 {isMounted
			? 'opacity-100'
			: 'opacity-0'}"
	></div>
</div>

<style>
	div :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
