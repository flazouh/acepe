<script lang="ts">
import { mode } from "mode-watcher";
import { createLogger } from "../../utils/logger.js";
import { renderMermaid } from "../../utils/mermaid-renderer.js";
import MermaidCanvas from "./mermaid/mermaid-canvas.svelte";
import MermaidFullscreenDialog from "./mermaid/mermaid-fullscreen-dialog.svelte";
import MermaidToolbar from "./mermaid/mermaid-toolbar.svelte";

const logger = createLogger({ id: "mermaid-diagram", name: "Mermaid Diagram" });

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

const isDark = $derived(mode.current === "dark");
const zoomLevel = $derived(Math.round(scale * 100));

$effect(() => {
	const currentCode = code;
	const currentIsDark = isDark;

	isLoading = true;
	error = null;
	svg = null;

	scale = 1;
	translateX = 0;
	translateY = 0;

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
	scale = Math.min(5, scale * 1.25);
}

function zoomOut(): void {
	scale = Math.max(0.2, scale * 0.8);
}

function resetZoom(): void {
	scale = 1;
	translateX = 0;
	translateY = 0;
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
