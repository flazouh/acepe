<script lang="ts">
	import { cn } from "../../lib/utils";
	import ArcSpinner from "./arc-spinner.svelte";
	import DotmHexSpinner from "./dotm-hex-spinner.svelte";
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

	const DOT_SIZE_RATIO = 2.55 / 24;

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

	const effectiveDotSize = $derived(dotSize ?? size * DOT_SIZE_RATIO);
	const effectiveVariant = $derived(variant ?? loadingIconPreference.variant);
	const effectiveColor = $derived(color ?? loadingIconPreference.colorHex);
</script>

{#if effectiveVariant === "arc-spin"}
	<ArcSpinner
		class={cn("shrink-0", className)}
		{style}
		{size}
		strokeWidth={Math.max(2.5, effectiveDotSize * 1.6)}
		color={effectiveColor}
		trackOpacity={0.25}
		role={role ?? "status"}
		aria-label={ariaLabel ?? "Loading"}
	/>
{:else}
	<DotmHexSpinner
		class={cn("shrink-0", className)}
		{style}
		{size}
		dotSize={effectiveDotSize}
		color={effectiveColor}
		variant={effectiveVariant}
		role={role ?? "status"}
		aria-label={ariaLabel ?? "Loading"}
	/>
{/if}
