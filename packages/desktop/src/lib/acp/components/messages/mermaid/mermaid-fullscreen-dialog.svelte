<script lang="ts">
import * as Dialog from "@acepe/ui/dialog";

import { createPanZoomHandlers } from "./use-pan-zoom.js";

let {
	open = $bindable(false),
	svg = null as string | null,
}: {
	open?: boolean;
	svg?: string | null;
} = $props();

let scale = $state(1);
let translateX = $state(0);
let translateY = $state(0);

const getState = () => ({ scale, translateX, translateY });
const setState = (updates: { scale?: number; translateX?: number; translateY?: number }) => {
	if (updates.scale !== undefined) scale = updates.scale;
	if (updates.translateX !== undefined) translateX = updates.translateX;
	if (updates.translateY !== undefined) translateY = updates.translateY;
};

const panZoom = createPanZoomHandlers(getState, setState, { minScale: 0.1, maxScale: 10 });

const transform = $derived(`translate(${translateX}px, ${translateY}px) scale(${scale})`);
const zoomLevel = $derived(Math.round(scale * 100));

$effect(() => {
	if (open) {
		scale = 1;
		translateX = 0;
		translateY = 0;
	}
});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="fullscreen-dialog-content" showCloseButton={false}>
		<div class="fullscreen-header">
			<Dialog.Title class="fullscreen-title">Diagram</Dialog.Title>
			<Dialog.Close class="close-btn">
				<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path
						d="M4 4l8 8M12 4l-8 8"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
				<span class="sr-only">Close</span>
			</Dialog.Close>
		</div>
		{#if svg}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fullscreen-viewport"
				onwheel={panZoom.handleWheel}
				onmousedown={panZoom.handleMouseDown}
				ontouchstart={panZoom.handleTouchStart}
				ontouchmove={panZoom.handleTouchMove}
				ontouchend={panZoom.handleTouchEnd}
			>
				<div class="svg-wrapper" style:transform>
					{@html svg}
				</div>
			</div>
		{/if}
		<div class="fullscreen-controls">
			<button type="button" class="zoom-btn" onclick={panZoom.zoomOut} title="Zoom out">
				<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
			</button>
			<button type="button" class="zoom-level" onclick={panZoom.resetZoom} title="Reset zoom">
				{zoomLevel}%
			</button>
			<button type="button" class="zoom-btn" onclick={panZoom.zoomIn} title="Zoom in">
				<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path
						d="M8 3v10M3 8h10"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	:global(.fullscreen-dialog-content) {
		display: flex;
		flex-direction: column;
		width: 90vw;
		height: 80vh;
		max-width: 1400px;
		max-height: 900px;
		padding: 0 !important;
		gap: 0 !important;
	}

	.fullscreen-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--muted) 30%, transparent);
	}

	:global(.fullscreen-title) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--foreground);
	}

	:global(.close-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--muted-foreground);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	:global(.close-btn:hover) {
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 50%, transparent);
	}

	:global(.close-btn svg) {
		width: 1rem;
		height: 1rem;
	}

	.fullscreen-viewport {
		flex: 1;
		overflow: hidden;
		cursor: grab;
		touch-action: none;
		user-select: none;
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--card) 80%, transparent),
			color-mix(in srgb, var(--card) 60%, transparent)
		);
	}

	.fullscreen-viewport:active {
		cursor: grabbing;
	}

	.svg-wrapper {
		display: inline-block;
		transform-origin: 0 0;
		will-change: transform;
	}

	.svg-wrapper :global(svg) {
		display: block;
		font-family: inherit;
	}

	.fullscreen-controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.5rem;
		border-top: 1px solid var(--border);
		background: color-mix(in srgb, var(--muted) 30%, transparent);
	}

	.fullscreen-controls .zoom-btn,
	.fullscreen-controls .zoom-level {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--muted-foreground);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.fullscreen-controls .zoom-btn:hover,
	.fullscreen-controls .zoom-level:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 50%, transparent);
	}

	.fullscreen-controls .zoom-level {
		min-width: 3rem;
		font-size: 0.6875rem;
		font-weight: 500;
		font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	}
</style>
