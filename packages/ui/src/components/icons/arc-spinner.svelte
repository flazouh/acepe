<script lang="ts">
	import { cn } from "../../lib/utils";

	interface Props {
		class?: string;
		style?: string;
		role?: string;
		"aria-label"?: string;
		size?: number;
		strokeWidth?: number;
		color?: string;
		trackOpacity?: number;
		speed?: number;
	}

	let {
		class: className = "",
		style: styleAttr = "",
		role = undefined,
		"aria-label": ariaLabel = undefined,
		size = 24,
		strokeWidth = 2.5,
		color = "currentColor",
		trackOpacity = 0.2,
		speed = 0.9,
	}: Props = $props();

	const viewBox = 24;
	const center = viewBox / 2;
	const radius = $derived((viewBox - strokeWidth) / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const arcLength = $derived(circumference * 0.25);
</script>

<svg
	class={cn("shrink-0", className)}
	style={styleAttr}
	width={size}
	height={size}
	viewBox="0 0 {viewBox} {viewBox}"
	fill="none"
	{role}
	aria-label={ariaLabel}
>
	<circle
		cx={center}
		cy={center}
		r={radius}
		stroke={color}
		stroke-opacity={trackOpacity}
		stroke-width={strokeWidth}
	/>
	<circle
		class="arc-spinner-arc"
		cx={center}
		cy={center}
		r={radius}
		stroke={color}
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-dasharray="{arcLength} {circumference}"
		style="--arc-spinner-duration: {speed}s; transform-origin: center;"
	/>
</svg>

<style>
	.arc-spinner-arc {
		animation: arc-spinner-rotate var(--arc-spinner-duration, 0.9s) linear infinite;
		transform-origin: center;
	}

	@keyframes arc-spinner-rotate {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
