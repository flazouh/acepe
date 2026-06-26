<script lang="ts">
	import DotmatrixLoader from "./dotmatrix/dotmatrix-loader.svelte";
	import {
		loadingIconPreference,
		type DotMatrixLoaderId,
	} from "./loading-icon-preferences.svelte.js";

	interface Props {
		class?: string;
		role?: string;
		"aria-label"?: string;
		style?: string;
		size?: number;
		dotSize?: number;
		variant?: DotMatrixLoaderId;
		color?: string;
	}

	let {
		class: className = "",
		role,
		"aria-label": ariaLabel,
		style = "",
		size = 24,
		dotSize = undefined,
		variant = undefined,
		color = undefined,
	}: Props = $props();

	const effectiveVariant = $derived(variant ?? loadingIconPreference.variant);
	const effectiveColor = $derived(color ?? loadingIconPreference.colorHex);
</script>

<DotmatrixLoader
	class={className}
	{style}
	{size}
	{dotSize}
	variant={effectiveVariant}
	color={effectiveColor}
	{role}
	aria-label={ariaLabel}
/>
