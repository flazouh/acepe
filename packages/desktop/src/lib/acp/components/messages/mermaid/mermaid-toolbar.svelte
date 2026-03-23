<script lang="ts">
let {
	zoomLevel = 100,
	onZoomIn,
	onZoomOut,
	onReset,
	onFullscreen,
}: {
	zoomLevel?: number;
	onZoomIn?: () => void;
	onZoomOut?: () => void;
	onReset?: () => void;
	onFullscreen?: () => void;
} = $props();
</script>

<div class="zoom-controls">
	<button type="button" class="zoom-btn" onclick={onZoomOut} title="Zoom out">
		<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
		</svg>
	</button>
	<button type="button" class="zoom-level" onclick={onReset} title="Reset zoom">
		{zoomLevel}%
	</button>
	<button type="button" class="zoom-btn" onclick={onZoomIn} title="Zoom in">
		<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
		</svg>
	</button>
	<div class="zoom-divider"></div>
	<button type="button" class="zoom-btn" onclick={onFullscreen} title="Fullscreen">
		<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>
</div>

<style>
	.zoom-controls {
		position: absolute;
		bottom: 0.5rem;
		right: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		background: color-mix(in srgb, var(--card) 90%, transparent);

		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.25rem;
	}

	.zoom-btn {
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

	.zoom-btn:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 50%, transparent);
	}

	.zoom-btn svg {
		width: 0.875rem;
		height: 0.875rem;
	}

	.zoom-level {
		min-width: 3rem;
		padding: 0.125rem 0.375rem;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--muted-foreground);
		font-size: 0.6875rem;
		font-weight: 500;
		font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
		cursor: pointer;
		text-align: center;
		transition: all 0.15s ease;
	}

	.zoom-level:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 50%, transparent);
	}

	.zoom-divider {
		width: 1px;
		height: 1rem;
		background: var(--border);
		margin: 0 0.125rem;
	}
</style>
