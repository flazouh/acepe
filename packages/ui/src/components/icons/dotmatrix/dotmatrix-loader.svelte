<script lang="ts">
	import { cn } from "../../../lib/utils";
	import ArcSpinner from "../arc-spinner.svelte";
	import DotmHexSpinner from "../dotm-hex-spinner.svelte";
	import DotmSquare18Spinner from "../dotm-square-18-spinner.svelte";
	import DotmatrixTriangleLoader from "../dotmatrix-triangle-loader.svelte";
	import type { DotMatrixLoaderId } from "../loading-icon-preferences.svelte.js";
	import DotmatrixRegistryLoader from "./dotmatrix-registry-loader.svelte";
	import { resolveDotmatrixLoaderRoute } from "./dotmatrix-loader-routing.js";

	interface Props {
		class?: string;
		role?: string;
		"aria-label"?: string;
		style?: string;
		size?: number;
		dotSize?: number;
		variant: DotMatrixLoaderId;
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
		variant,
		color = "#bf8700",
	}: Props = $props();

	const effectiveDotSize = $derived(dotSize ?? size * DOT_SIZE_RATIO);
	const route = $derived(resolveDotmatrixLoaderRoute(variant));
	const sharedProps = $derived({
		class: cn("shrink-0", className),
		style,
		size,
		color,
		role: role ?? "status",
		ariaLabel: ariaLabel ?? "Loading",
	});
</script>

{#if route.kind === "arc"}
	<ArcSpinner
		class={sharedProps.class}
		style={sharedProps.style}
		size={sharedProps.size}
		strokeWidth={Math.max(2.5, effectiveDotSize * 1.6)}
		color={sharedProps.color}
		trackOpacity={0.25}
		role={sharedProps.role}
		aria-label={sharedProps.ariaLabel}
	/>
{:else if route.kind === "hex"}
	<DotmHexSpinner
		class={sharedProps.class}
		style={sharedProps.style}
		size={sharedProps.size}
		dotSize={effectiveDotSize}
		color={sharedProps.color}
		variant={route.variant}
		role={sharedProps.role}
		aria-label={sharedProps.ariaLabel}
	/>
{:else if route.kind === "square-18"}
	<DotmSquare18Spinner
		class={sharedProps.class}
		style={sharedProps.style}
		size={sharedProps.size}
		dotSize={effectiveDotSize}
		color={sharedProps.color}
		role={sharedProps.role}
		aria-label={sharedProps.ariaLabel}
	/>
{:else if route.kind === "triangle"}
	<DotmatrixTriangleLoader
		class={sharedProps.class}
		style={sharedProps.style}
		size={sharedProps.size}
		dotSize={effectiveDotSize}
		color={sharedProps.color}
		variant={route.variant}
		role={sharedProps.role}
		aria-label={sharedProps.ariaLabel}
	/>
{:else}
	<DotmatrixRegistryLoader
		class={sharedProps.class}
		size={sharedProps.size}
		dotSize={effectiveDotSize}
		color={sharedProps.color}
		loaderId={route.loaderId}
		ariaLabel={sharedProps.ariaLabel}
	/>
{/if}
