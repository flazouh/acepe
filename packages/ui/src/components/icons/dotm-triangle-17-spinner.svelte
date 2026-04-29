<!--
  Ported from @dotmatrix/dotm-triangle-17 (https://dotmatrix.zzzzshawn.cloud/r/dotm-triangle-17.json).
  React registry uses hooks; this file reimplements the same mask, path, opacity, and cycle timing for Svelte.
-->
<script lang="ts">
	import { onMount } from "svelte";
	import { cn } from "../../lib/utils";

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
		speed = 1.8,
	}: Props = $props();

	const isDecorative = $derived(role === undefined && ariaLabel === undefined);

	const MATRIX_SIZE = 7;
	const BASE_OPACITY = 0.06;
	const HIGH_OPACITY = 0.95;
	const TRAIL_SPAN = 4.35;
	const CYCLE_MS_BASE = 1500;

	const TRIANGLE_CELLS = new Set([
		"1,3",
		"2,2",
		"2,4",
		"3,1",
		"3,3",
		"3,5",
		"4,0",
		"4,2",
		"4,4",
		"4,6",
	]);

	const INFINITY_PATH: ReadonlyArray<readonly [number, number]> = [
		[4, 0],
		[3, 1],
		[2, 2],
		[1, 3],
		[2, 4],
		[3, 5],
		[4, 6],
		[4, 4],
		[3, 3],
		[4, 2],
	];

	const PATH_LEN = INFINITY_PATH.length;

	function isWithinTriangleMask(row: number, col: number): boolean {
		if (row < 0 || row >= MATRIX_SIZE || col < 0 || col >= MATRIX_SIZE) {
			return false;
		}
		return TRIANGLE_CELLS.has(`${row},${col}`);
	}

	function pathIndex(row: number, col: number): number | null {
		for (let i = 0; i < PATH_LEN; i += 1) {
			const step = INFINITY_PATH[i];
			if (step === undefined) {
				continue;
			}
			const [pr, pc] = step;
			if (pr === row && pc === col) {
				return i;
			}
		}
		return null;
	}

	function modF(n: number, m: number): number {
		return ((n % m) + m) % m;
	}

	function behindAlongPath(s: number, i: number, L: number): number {
		return modF(s - i, L);
	}

	function smoothstep01(edge0: number, edge1: number, x: number): number {
		if (edge1 <= edge0) {
			return x >= edge1 ? 1 : 0;
		}
		const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
		return t * t * (3 - 2 * t);
	}

	function opacityForCell(row: number, col: number, phase: number): number {
		const idx = pathIndex(row, col);
		if (idx === null) {
			return 0;
		}
		const s = phase * PATH_LEN;
		const d = behindAlongPath(s, idx, PATH_LEN);
		const g = 1 - smoothstep01(0, TRAIL_SPAN, d);
		return BASE_OPACITY + g * (HIGH_OPACITY - BASE_OPACITY);
	}

	function styleOpacity(opacity: number): number {
		return Math.round(opacity * 1e6) / 1e6;
	}

	let cyclePhase = $state(0);
	let reducedMotion = $state(false);

	const gap = $derived(Math.max(1, Math.floor((size - dotSize * MATRIX_SIZE) / (MATRIX_SIZE - 1))));

	const displayPhase = $derived(!animated || reducedMotion ? 0.12 : cyclePhase);

	const rootStyle = $derived(`width:${size}px;height:${size}px;color:${color};${styleAttr}`.trim());

	const gridStyle = $derived(
		`gap:${gap}px;grid-template-columns:repeat(${MATRIX_SIZE},minmax(0,1fr));grid-template-rows:repeat(${MATRIX_SIZE},minmax(0,1fr))`,
	);

	onMount(() => {
		if (typeof window === "undefined") {
			return;
		}
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		let raf: number | null = null;
		const stopAnimation = (): void => {
			if (raf !== null) {
				window.cancelAnimationFrame(raf);
				raf = null;
			}
		};
		const startAnimation = (): void => {
			if (raf === null) {
				raf = window.requestAnimationFrame(tick);
			}
		};
		const syncReduced = (): void => {
			reducedMotion = mq.matches;
			if (!animated || mq.matches) {
				cyclePhase = 0.12;
				stopAnimation();
			} else {
				startAnimation();
			}
		};
		const t0 = performance.now();
		const tick = (now: number): void => {
			if (!animated || mq.matches) {
				cyclePhase = 0.12;
				raf = null;
				return;
			}
			const safeSpeed = speed > 0 ? speed : 1;
			const cycleMs = CYCLE_MS_BASE / safeSpeed;
			const elapsed = ((now - t0) % cycleMs + cycleMs) % cycleMs;
			cyclePhase = elapsed / cycleMs;
			raf = window.requestAnimationFrame(tick);
		};
		mq.addEventListener("change", syncReduced);
		syncReduced();
		return (): void => {
			mq.removeEventListener("change", syncReduced);
			stopAnimation();
		};
	});
</script>

<div
	class={cn("acepe-dotm-root", className)}
	style={rootStyle}
	aria-hidden={isDecorative ? "true" : undefined}
	{role}
	aria-label={ariaLabel}
>
	<div class="acepe-dotm-grid" style={gridStyle}>
		{#each Array.from({ length: MATRIX_SIZE * MATRIX_SIZE }, (_, index) => index) as index (index)}
			{@const row = Math.floor(index / MATRIX_SIZE)}
			{@const col = index % MATRIX_SIZE}
			{@const isActive = isWithinTriangleMask(row, col)}
			{@const opacity = isActive ? opacityForCell(row, col, displayPhase) : 0}
			<span
				aria-hidden="true"
				class={cn("acepe-dotm-dot", !isActive && "acepe-dotm-inactive")}
				style="width:{dotSize}px;height:{dotSize}px;opacity:{styleOpacity(opacity)}"
			></span>
		{/each}
	</div>
</div>

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
