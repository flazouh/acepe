<!--
  Router for dotm-triangle-1..20. Variants 17 and 20 delegate to dedicated spinners;
  all others use the shared JS phase loop from dotmatrix/triangle-loaders.ts.
-->
<script lang="ts">
	import { onMount } from "svelte";
	import { cn } from "../../lib/utils";
	import DotmTriangle17Spinner from "./dotm-triangle-17-spinner.svelte";
	import DotmTriangle20Spinner from "./dotm-triangle-20-spinner.svelte";
	import type { DotmTriangleLoaderVariant } from "./dotmatrix/dotmatrix-loader-routing.js";
	import { TRIANGLE_MATRIX_SIZE, isWithinTriangleMask, styleOpacity } from "./dotmatrix/triangle-core.js";
	import {
		isTriangleLoaderId,
		triangleLoaderConfig,
	} from "./dotmatrix/triangle-loaders.js";

	interface Props {
		class?: string;
		style?: string;
		role?: string;
		"aria-label"?: string;
		size?: number;
		dotSize?: number;
		color?: string;
		animated?: boolean;
		speed?: number;
		variant?: DotmTriangleLoaderVariant;
	}

	let {
		class: className = "",
		style: styleAttr = "",
		role = undefined,
		"aria-label": ariaLabel = undefined,
		size = 24,
		dotSize = 2.55,
		color = "#bf8700",
		animated = true,
		speed = undefined,
		variant = "dotm-triangle-1",
	}: Props = $props();

	const isDecorative = $derived(role === undefined && ariaLabel === undefined);
	const usesDedicatedSpinner = $derived(variant === "dotm-triangle-17" || variant === "dotm-triangle-20");

	const loaderConfig = $derived.by(() => {
		if (!isTriangleLoaderId(variant)) {
			return triangleLoaderConfig("dotm-triangle-1");
		}
		return triangleLoaderConfig(variant);
	});

	const effectiveSpeed = $derived(speed ?? loaderConfig.defaultSpeed);
	const cycleMs = $derived(
		loaderConfig.cycleMsBase / (effectiveSpeed > 0 ? effectiveSpeed : 1),
	);

	const gap = $derived(
		Math.max(0.25, (size - dotSize * TRIANGLE_MATRIX_SIZE) / (TRIANGLE_MATRIX_SIZE - 1)),
	);

	let cyclePhase = $state(0);
	let reducedMotion = $state(false);

	const displayPhase = $derived(
		!animated || reducedMotion ? loaderConfig.idlePhase : cyclePhase,
	);

	const rootStyle = $derived(`width:${size}px;height:${size}px;color:${color};${styleAttr}`.trim());

	const gridStyle = $derived(
		`gap:${gap}px;grid-template-columns:repeat(${TRIANGLE_MATRIX_SIZE},minmax(0,1fr));grid-template-rows:repeat(${TRIANGLE_MATRIX_SIZE},minmax(0,1fr))`,
	);

	function opacityAt(row: number, col: number): number {
		if (!isWithinTriangleMask(row, col)) {
			return 0;
		}
		return loaderConfig.opacityForCell(row, col, displayPhase);
	}

	onMount(() => {
		if (typeof window === "undefined") {
			return;
		}
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		let raf: number | null = null;
		let schedulingFrame = false;
		let synchronousRafDetected = false;
		const stopAnimation = (): void => {
			if (raf !== null) {
				window.cancelAnimationFrame(raf);
				raf = null;
			}
		};
		const requestNextFrame = (): void => {
			if (synchronousRafDetected) {
				return;
			}
			let ranSynchronously = false;
			schedulingFrame = true;
			const requestId = window.requestAnimationFrame((now) => {
				ranSynchronously = true;
				raf = null;
				if (schedulingFrame) {
					synchronousRafDetected = true;
					cyclePhase = loaderConfig.idlePhase;
					return;
				}
				tick(now);
			});
			schedulingFrame = false;
			raf = ranSynchronously ? null : requestId;
		};
		const startAnimation = (): void => {
			if (raf === null) {
				requestNextFrame();
			}
		};
		const syncReduced = (): void => {
			reducedMotion = mq.matches;
			if (!animated || mq.matches) {
				cyclePhase = loaderConfig.idlePhase;
				stopAnimation();
			} else {
				startAnimation();
			}
		};
		const t0 = performance.now();
		const tick = (now: number): void => {
			if (!animated || mq.matches) {
				cyclePhase = loaderConfig.idlePhase;
				raf = null;
				return;
			}
			const safeSpeed = effectiveSpeed > 0 ? effectiveSpeed : 1;
			const elapsed = ((now - t0) % cycleMs + cycleMs) % cycleMs;
			cyclePhase = elapsed / cycleMs;
			requestNextFrame();
		};
		mq.addEventListener("change", syncReduced);
		syncReduced();
		return (): void => {
			mq.removeEventListener("change", syncReduced);
			stopAnimation();
		};
	});
</script>

{#if usesDedicatedSpinner}
	{#if variant === "dotm-triangle-17"}
		<DotmTriangle17Spinner
			class={className}
			style={styleAttr}
			{size}
			{dotSize}
			{color}
			{animated}
			speed={speed ?? 1.8}
			{role}
			aria-label={ariaLabel}
		/>
	{:else}
		<DotmTriangle20Spinner
			class={className}
			style={styleAttr}
			{size}
			{dotSize}
			{color}
			{animated}
			speed={speed ?? 1.7}
			{role}
			aria-label={ariaLabel}
		/>
	{/if}
{:else}
	<div
		class={cn("acepe-dotm-root", className)}
		style={rootStyle}
		aria-hidden={isDecorative ? "true" : undefined}
		{role}
		aria-label={ariaLabel}
	>
		<div class="acepe-dotm-grid" style={gridStyle}>
			{#each Array.from({ length: TRIANGLE_MATRIX_SIZE * TRIANGLE_MATRIX_SIZE }, (_, index) => index) as index (index)}
				{@const row = Math.floor(index / TRIANGLE_MATRIX_SIZE)}
				{@const col = index % TRIANGLE_MATRIX_SIZE}
				{@const isActive = isWithinTriangleMask(row, col)}
				{@const opacity = isActive ? opacityAt(row, col) : 0}
				<span
					aria-hidden="true"
					class={cn("acepe-dotm-dot", !isActive && "acepe-dotm-inactive")}
					style="width:{dotSize}px;height:{dotSize}px;opacity:{styleOpacity(opacity)}"
				></span>
			{/each}
		</div>
	</div>
{/if}

<style>
	.acepe-dotm-root {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		vertical-align: middle;
	}

	.acepe-dotm-grid {
		display: grid;
	}

	.acepe-dotm-dot {
		border-radius: 999px;
		display: block;
		background: currentColor;
		will-change: opacity;
	}

	.acepe-dotm-dot.acepe-dotm-inactive {
		opacity: 0 !important;
		visibility: hidden;
		pointer-events: none;
		will-change: auto;
	}
</style>
