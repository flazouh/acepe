<script lang="ts">
import {
	getShaderColorFromString,
	grainGradientFragmentShader,
	ShaderMount,
} from "@paper-design/shaders";
import { onMount } from "svelte";
import { cn } from "$lib/utils.js";

let { class: className } = $props();
let container: HTMLDivElement | undefined = $state();
let isMounted = $state(false);

onMount(() => {
	isMounted = true;

	if (container) {
		new ShaderMount(container, grainGradientFragmentShader, {
			colors: [
				getShaderColorFromString("#C1823C"),
				getShaderColorFromString("#d69d5c"),
				getShaderColorFromString("#a66a20"),
				getShaderColorFromString("#ffb380"),
			],
			colorBack: getShaderColorFromString("#1a1a1a"),
			softness: 0.5,
			intensity: 0.5,
			noise: 0.25,
			shape: 4,
			speed: 1,
		});
	}
});
</script>

<div class={cn("absolute inset-0 overflow-hidden", className)}>
	<div
		bind:this={container}
		class={cn(
			"absolute inset-0 block h-full w-full transition-opacity duration-1000",
			isMounted ? "opacity-100" : "opacity-0"
		)}
	></div>

	{#if !isMounted}
		<div class="absolute inset-0 bg-gradient-to-br from-[#C1823C] to-[#1a1a1a]"></div>
	{/if}
</div>

<style>
	div :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
