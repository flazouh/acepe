<script lang="ts">
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		status?: AgentToolStatus;
		/** Active dot color (CSS color). Default amber-500. */
		activeColor?: string;
		/** Full clockwise cycle duration in ms. Default 1600. */
		cycleMs?: number;
		/** Vertical spacing between rows in px — drives row count. Default 10. */
		rowSpacingPx?: number;
	}

	let {
		status = "running",
		activeColor = "#f59e0b",
		cycleMs = 1600,
		rowSpacingPx = 10,
	}: Props = $props();

	let height = $state(0);

	const rowCount = $derived(Math.max(2, Math.floor(height / rowSpacingPx)));
	const totalSteps = $derived(rowCount * 2);
	const animated = $derived(status === "running");

	function getCellIndex(row: number, col: number, rows: number): number {
		if (row === 0 && col === 0) return 0;
		if (col === 1) return row + 1;
		return 2 * rows - row;
	}
</script>

<div
	bind:clientHeight={height}
	class="acepe-thinking-dotmatrix flex shrink-0 flex-col justify-between self-stretch py-0.5"
	style="--dmx-color: {activeColor}; --dmx-cycle: {cycleMs}ms;"
	aria-hidden="true"
>
	{#each Array(rowCount) as _, row (row)}
		<div class="flex gap-[3px]">
			{#each [0, 1] as col (col)}
				{@const index = getCellIndex(row, col, rowCount)}
				{@const delayMs = -((index / Math.max(1, totalSteps)) * cycleMs)}
				<span
					class="acepe-thinking-dot"
					class:is-animated={animated}
					style="--dmx-delay: {delayMs}ms;"
				></span>
			{/each}
		</div>
	{/each}
</div>

<style>
	.acepe-thinking-dot {
		display: block;
		width: 3px;
		height: 3px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--dmx-color) 18%, transparent);
	}

	.acepe-thinking-dot.is-animated {
		animation-name: acepe-thinking-dotmatrix-tick;
		animation-duration: var(--dmx-cycle);
		animation-delay: var(--dmx-delay);
		animation-iteration-count: infinite;
		animation-timing-function: linear;
	}

	@keyframes acepe-thinking-dotmatrix-tick {
		0%,
		8% {
			background: var(--dmx-color);
			transform: scale(1.25);
		}
		20%,
		100% {
			background: color-mix(in srgb, var(--dmx-color) 18%, transparent);
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.acepe-thinking-dot.is-animated {
			animation: none;
			background: color-mix(in srgb, var(--dmx-color) 34%, transparent);
		}
	}
</style>
