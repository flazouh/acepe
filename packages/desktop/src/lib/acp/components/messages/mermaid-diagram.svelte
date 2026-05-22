<script lang="ts">
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { createLogger } from "../../utils/logger.js";
import { renderMermaid } from "../../utils/mermaid-renderer.js";
import MermaidCanvas from "./mermaid/mermaid-canvas.svelte";
import MermaidFullscreenDialog from "./mermaid/mermaid-fullscreen-dialog.svelte";
import {
	getPanZoomLevel,
	resetMermaidPanZoomState,
	zoomMermaidPanZoomIn,
	zoomMermaidPanZoomOut,
} from "./mermaid/mermaid-pan-zoom-state.js";
import MermaidToolbar from "./mermaid/mermaid-toolbar.svelte";

const logger = createLogger({ id: "mermaid-diagram", name: "Mermaid Diagram" });
const themeState = useTheme();

let { code }: { code: string } = $props();

let svg = $state<string | null>(null);
let error = $state<string | null>(null);
let isLoading = $state(true);
let showSource = $state(false);
let isFullscreen = $state(false);

// Pan/zoom state for inline view (bound to canvas)
let scale = $state(1);
let translateX = $state(0);
let translateY = $state(0);

const isDark = $derived(themeState?.effectiveTheme !== "light");
const zoomLevel = $derived(getPanZoomLevel(scale));

function setPanZoomState(next: { scale: number; translateX: number; translateY: number }): void {
	scale = next.scale;
	translateX = next.translateX;
	translateY = next.translateY;
}

$effect(() => {
	const currentCode = code;
	const currentIsDark = isDark;

	isLoading = true;
	error = null;
	svg = null;

	setPanZoomState(resetMermaidPanZoomState());

	renderMermaid(currentCode, currentIsDark).match(
		(result) => {
			svg = result;
			isLoading = false;
		},
		(err) => {
			logger.error("Mermaid rendering failed:", err);
			error = err.message;
			isLoading = false;
		}
	);
});

function toggleSource(): void {
	showSource = !showSource;
}

function zoomIn(): void {
	setPanZoomState(zoomMermaidPanZoomIn({ scale, translateX, translateY }));
}

function zoomOut(): void {
	setPanZoomState(zoomMermaidPanZoomOut({ scale, translateX, translateY }));
}

function resetZoom(): void {
	setPanZoomState(resetMermaidPanZoomState());
}

function openFullscreen(): void {
	isFullscreen = true;
}
</script>

<div class="mermaid-container">
	<div class="mermaid-wrapper">
		<MermaidCanvas
			{svg}
			loading={isLoading}
			{error}
			{code}
			{showSource}
			onToggleSource={toggleSource}
			bind:scale
			bind:translateX
			bind:translateY
		/>
		{#if svg}
			<MermaidToolbar
				{zoomLevel}
				onZoomIn={zoomIn}
				onZoomOut={zoomOut}
				onReset={resetZoom}
				onFullscreen={openFullscreen}
			/>
		{/if}
	</div>
</div>

<MermaidFullscreenDialog bind:open={isFullscreen} {svg} />

<style>
	.mermaid-container {
		margin: 0.75rem 0;
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--card) 80%, transparent),
			color-mix(in srgb, var(--card) 60%, transparent)
		);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		box-shadow: var(--shadow-xs);
	}

	.mermaid-wrapper {
		position: relative;
	}
</style>
