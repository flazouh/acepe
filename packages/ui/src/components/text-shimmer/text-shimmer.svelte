<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		/** Animation duration in seconds. Cursor uses 2s. */
		duration?: number;
		/** Background-size multiplier. Cursor uses 200%. */
		spread?: number;
		delay?: number;
		class?: string;
	}

	let { children, duration = 2, spread = 2, delay = 0, class: className = "" }: Props = $props();

	const animationDuration = $derived(`${duration}s`);
	const animationDelay = $derived(`${delay}s`);
	const spreadPercentage = $derived(`${spread * 100}%`);
</script>

<span
	class="text-shimmer inline-block {className}"
	style="--shimmer-duration: {animationDuration}; --shimmer-delay: {animationDelay}; --shimmer-spread: {spreadPercentage};"
>
	{@render children()}
</span>

<style>
	.text-shimmer {
		--shimmer-muted-color: color-mix(in srgb, currentColor 60%, transparent);
		--shimmer-highlight-color: currentColor;
		background-image: linear-gradient(
			90deg,
			var(--shimmer-muted-color) 0% 25%,
			var(--shimmer-highlight-color) 60%,
			var(--shimmer-muted-color) 75% 100%
		);
		background-size: var(--shimmer-spread) 100%;
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		animation: text-shimmer var(--shimmer-duration) linear infinite;
		animation-delay: var(--shimmer-delay);
	}

	@keyframes text-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.text-shimmer {
			animation: none;
			background: none;
			background-clip: unset;
			-webkit-background-clip: unset;
			-webkit-text-fill-color: unset;
		}
	}
</style>
