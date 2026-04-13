<script lang="ts">
import * as m from "$lib/messages.js";

import { createPanZoomHandlers } from "./use-pan-zoom.js";

let {
	svg = null as string | null,
	loading = false,
	error = null as string | null,
	code = "",
	showSource = false,
	onToggleSource,
	scale = $bindable(1),
	translateX = $bindable(0),
	translateY = $bindable(0),
}: {
	svg?: string | null;
	loading?: boolean;
	error?: string | null;
	code?: string;
	showSource?: boolean;
	onToggleSource?: () => void;
	scale?: number;
	translateX?: number;
	translateY?: number;
} = $props();

const getState = () => ({ scale, translateX, translateY });
const setState = (updates: { scale?: number; translateX?: number; translateY?: number }) => {
	if (updates.scale !== undefined) scale = updates.scale;
	if (updates.translateX !== undefined) translateX = updates.translateX;
	if (updates.translateY !== undefined) translateY = updates.translateY;
};

const panZoom = createPanZoomHandlers(getState, setState, { minScale: 0.2, maxScale: 5 });

const transform = $derived(`translate(${translateX}px, ${translateY}px) scale(${scale})`);

function toggleSource(): void {
	onToggleSource?.();
}
</script>

{#if loading}
	<div class="mermaid-loading">
		<div class="loading-spinner"></div>
		<span class="loading-text">{m.mermaid_loading()}</span>
	</div>
{:else if error}
	<div class="mermaid-error">
		<div class="error-header">
			<svg class="error-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path
					d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
					fill="currentColor"
				/>
			</svg>
			<p class="error-title">{m.mermaid_render_error()}</p>
		</div>
		<p class="error-message">{error}</p>
		<button type="button" class="source-toggle" onclick={toggleSource}>
			{showSource ? m.mermaid_hide_source() : m.mermaid_show_source()}
		</button>
		{#if showSource}
			<pre class="error-code">{code}</pre>
		{/if}
	</div>
{:else if svg}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="mermaid-viewport"
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
{:else}
	<!-- empty state -->
{/if}

<style>
	.mermaid-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 2.5rem;
		color: var(--muted-foreground);
	}

	.loading-spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--border);
		border-top-color: var(--primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-text {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.mermaid-error {
		padding: 1rem 1.25rem;
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--destructive) 8%, transparent),
			color-mix(in srgb, var(--destructive) 4%, transparent)
		);
		border-top: 2px solid color-mix(in srgb, var(--destructive) 40%, transparent);
	}

	.error-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.error-icon {
		width: 1rem;
		height: 1rem;
		color: var(--destructive);
		flex-shrink: 0;
	}

	.error-title {
		font-weight: 600;
		color: var(--destructive);
		font-size: 0.8125rem;
		letter-spacing: -0.01em;
	}

	.error-message {
		font-size: 0.75rem;
		color: var(--muted-foreground);
		margin-bottom: 0.75rem;
		line-height: 1.5;
		padding-left: 1.5rem;
	}

	.source-toggle {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--muted-foreground);
		background: none;
		border: none;
		padding: 0.25rem 0.5rem;
		margin-left: 1rem;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: all 0.15s ease;
	}

	.source-toggle:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 50%, transparent);
	}

	.error-code {
		margin-top: 0.75rem;
		margin-left: 1.5rem;
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, var(--background) 80%, transparent);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
		font-size: 0.6875rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--foreground);
	}

	.mermaid-viewport {
		height: 350px;
		overflow: hidden;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.mermaid-viewport:active {
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
</style>
