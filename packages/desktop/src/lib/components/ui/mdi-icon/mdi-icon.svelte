<script lang="ts">
import type { Component } from "svelte";

interface Props {
	// For backward compatibility - MDI path strings
	path?: string;
	// For imported SVG components
	svg?: Component<{ class?: string }>;
	// For inline SVG path data
	iconPath?: string;
	class?: string;
}

let { path, svg: SvgComponent, iconPath, class: className = "" }: Props = $props();
</script>

{#if SvgComponent}
	<!-- Imported SVG component (for file type icons) -->
	<SvgComponent class={className} />
{:else if iconPath}
	<!-- Inline SVG path (for UI icons) -->
	<svg viewBox="0 0 24 24" class={className} fill="currentColor" aria-hidden="true">
		<path d={iconPath} />
	</svg>
{:else if path}
	<!-- Legacy MDI path support -->
	<svg viewBox="0 0 24 24" class={className} fill="currentColor" aria-hidden="true">
		<path d={path} />
	</svg>
{/if}
