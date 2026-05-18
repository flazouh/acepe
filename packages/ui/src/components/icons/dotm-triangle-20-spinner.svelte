<!--
  Ported from @dotmatrix/dotm-triangle-20 "Twin Perimeter"
  (https://dotmatrix.zzzzshawn.cloud/r/dotm-triangle-20.json).
  This Svelte port keeps the registry shape/path but uses CSS-only opacity cycles.
-->
<script lang="ts">
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
		speed = 1.7,
	}: Props = $props();

	const MATRIX_SIZE = 7;
	const CENTER_KEY = "3,3";
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
	const PERIMETER_PATH: ReadonlyArray<readonly [number, number]> = [
		[1, 3],
		[2, 2],
		[3, 1],
		[4, 0],
		[4, 2],
		[4, 4],
		[4, 6],
		[3, 5],
		[2, 4],
	];
	const PATH_LEN = PERIMETER_PATH.length;
	const CYCLE_MS_BASE = 1800;

	const isDecorative = $derived(role === undefined && ariaLabel === undefined);
	const gap = $derived(Math.max(0.25, (size - dotSize * MATRIX_SIZE) / (MATRIX_SIZE - 1)));
	const cycleMs = $derived(`${CYCLE_MS_BASE / (speed > 0 ? speed : 1)}ms`);
	const rootStyle = $derived(`width:${size}px;height:${size}px;color:${color};${styleAttr}`.trim());
	const gridStyle = $derived(
		`gap:${gap}px;grid-template-columns:repeat(${MATRIX_SIZE},minmax(0,1fr));grid-template-rows:repeat(${MATRIX_SIZE},minmax(0,1fr))`
	);

	function cellKey(row: number, col: number): string {
		return `${row},${col}`;
	}

	function isWithinTriangleMask(row: number, col: number): boolean {
		return TRIANGLE_CELLS.has(cellKey(row, col));
	}

	function pathIndex(row: number, col: number): number | null {
		for (let index = 0; index < PATH_LEN; index += 1) {
			const step = PERIMETER_PATH[index];
			if (step === undefined) {
				continue;
			}
			const [pathRow, pathCol] = step;
			if (pathRow === row && pathCol === col) {
				return index;
			}
		}
		return null;
	}

	function dotStyle(row: number, col: number): string {
		const index = pathIndex(row, col);
		const base = `width:${dotSize}px;height:${dotSize}px;--dmx-cycle:${cycleMs}`;
		if (!animated || index === null) {
			const opacity = cellKey(row, col) === CENTER_KEY ? 0.2 : 0.08;
			return `${base};opacity:${opacity}`;
		}
		const delay = -(index / PATH_LEN) * (CYCLE_MS_BASE / (speed > 0 ? speed : 1));
		return `${base};animation-delay:${delay}ms`;
	}
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
			<span
				aria-hidden="true"
				class={cn(
					"acepe-dotm-dot",
					animated && pathIndex(row, col) !== null && "acepe-dotm-animated",
					cellKey(row, col) === CENTER_KEY && "acepe-dotm-center",
					!isActive && "acepe-dotm-inactive"
				)}
				style={dotStyle(row, col)}
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
		opacity: 0.08;
	}

	.acepe-dotm-dot.acepe-dotm-animated {
		animation: acepe-dotm-triangle20 var(--dmx-cycle) linear infinite;
	}

	.acepe-dotm-dot.acepe-dotm-center {
		opacity: 0.2;
	}

	.acepe-dotm-dot.acepe-dotm-inactive {
		opacity: 0 !important;
		visibility: hidden;
		pointer-events: none;
	}

	@keyframes acepe-dotm-triangle20 {
		0%,
		50% {
			opacity: 0.94;
		}
		18%,
		68% {
			opacity: 0.48;
		}
		37%,
		49%,
		87%,
		100% {
			opacity: 0.08;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.acepe-dotm-dot.acepe-dotm-animated {
			animation: none;
			opacity: 0.2;
		}
	}
</style>
