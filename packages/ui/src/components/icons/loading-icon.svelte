<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";
	import { loadingIconPreference } from "./loading-icon-preferences.svelte.js";

	interface Props {
		class?: string;
		role?: string;
		"aria-label"?: string;
		style?: string;
		size?: number;
		dotSize?: number;
		variant?: string;
		color?: string;
	}

	let {
		class: className = "",
		role,
		"aria-label": ariaLabel,
		style,
		size = 24,
		dotSize: _dotSize,
		variant: _variant,
		color,
	}: Props = $props();

	const effectiveColor = $derived(color ?? loadingIconPreference.colorHex);
	const iconClass = $derived(
		[className, "loading-icon-segments"].filter(Boolean).join(" "),
	);
	const resolvedStyle = $derived(
		`${style ?? ""}${style?.trim().endsWith(";") ? "" : ";"}color: ${effectiveColor};`,
	);
</script>

<HugeiconsIcon
	name="spinner"
	{size}
	class={iconClass}
	style={resolvedStyle}
	{role}
	aria-label={ariaLabel}
/>

<style>
	:global(svg.loading-icon-segments.animate-spin) {
		animation: none;
	}

	:global(svg.loading-icon-segments path) {
		animation: loading-icon-segment 1s linear infinite;
		opacity: 0.25;
	}

	:global(svg.loading-icon-segments path:nth-child(1)) {
		animation-delay: 0s;
	}

	:global(svg.loading-icon-segments path:nth-child(2)) {
		animation-delay: -0.125s;
	}

	:global(svg.loading-icon-segments path:nth-child(3)) {
		animation-delay: -0.25s;
	}

	:global(svg.loading-icon-segments path:nth-child(4)) {
		animation-delay: -0.375s;
	}

	:global(svg.loading-icon-segments path:nth-child(5)) {
		animation-delay: -0.5s;
	}

	:global(svg.loading-icon-segments path:nth-child(6)) {
		animation-delay: -0.625s;
	}

	:global(svg.loading-icon-segments path:nth-child(7)) {
		animation-delay: -0.75s;
	}

	:global(svg.loading-icon-segments path:nth-child(8)) {
		animation-delay: -0.875s;
	}

	@keyframes loading-icon-segment {
		0%,
		12.5% {
			opacity: 1;
		}

		12.51%,
		100% {
			opacity: 0.25;
		}
	}
</style>
