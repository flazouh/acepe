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
	const resolvedStyle = $derived(
		`${style ?? ""}${style?.trim().endsWith(";") ? "" : ";"}color: ${effectiveColor};`,
	);
</script>

<HugeiconsIcon
	name="spinner"
	{size}
	class={className}
	style={resolvedStyle}
	{role}
	aria-label={ariaLabel}
/>
