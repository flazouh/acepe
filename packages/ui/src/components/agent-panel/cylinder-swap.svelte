<script lang="ts">
	import type { Snippet } from "svelte";
	import { cylinderIn, cylinderOut } from "./cylinder-transition.js";

	interface Props {
		/** Identity of the current content. When it changes, the swap animates. */
		key: string | number;
		/** Line height of the viewport (CSS length). */
		height?: string;
		/** Transition duration in milliseconds. */
		duration?: number;
		class?: string;
		children: Snippet;
	}

	let {
		key,
		height = "1.375rem",
		duration = 340,
		class: className = "",
		children,
	}: Props = $props();
</script>

<div class={`cylinder-swap ${className}`.trim()} style:--cylinder-height={height}>
	{#key key}
		<div
			class="cylinder-swap__item"
			in:cylinderIn={{ duration }}
			out:cylinderOut={{ duration }}
		>
			{@render children()}
		</div>
	{/key}
</div>

<style>
	.cylinder-swap {
		position: relative;
		height: var(--cylinder-height);
		min-width: 0;
		overflow: hidden;
		perspective: 280px;
		transform-style: preserve-3d;
	}

	.cylinder-swap__item {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		min-width: 0;
		backface-visibility: hidden;
		transform-origin: center center;
		will-change: transform, opacity;
	}
</style>
