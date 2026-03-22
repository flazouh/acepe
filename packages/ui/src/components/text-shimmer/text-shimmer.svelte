<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		duration?: number;
		spread?: number;
		delay?: number;
		class?: string;
	}

	let { children, duration = 1.2, spread = 2, delay = 0, class: className = "" }: Props = $props();

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
		background: linear-gradient(
			90deg,
			currentColor 0%,
			currentColor 40%,
			color-mix(in srgb, currentColor 60%, transparent) 50%,
			currentColor 60%,
			currentColor 100%
		);
		background-size: var(--shimmer-spread) 100%;
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		animation: shimmer var(--shimmer-duration) ease-in-out infinite;
		animation-delay: var(--shimmer-delay);
	}

	@keyframes shimmer {
		0% {
			background-position: -200% 0;
		}
		100% {
			background-position: 200% 0;
		}
	}
</style>
