<script lang="ts">
	import { HugeiconsIcon as HugeiconsRenderer } from "@hugeicons/svelte";
	import {
		resolveHugeiconsIcon,
		type HugeiconsIconName,
	} from "./hugeicons-icon-registry.js";

	interface Props {
		name: HugeiconsIconName;
		size?: number;
		/**
		 * When true, omit strokeWidth so registry icons with `fill="currentColor"`
		 * render as solid marks (brand logos). Stroke icons stay the default.
		 */
		filled?: boolean;
		class?: string;
		style?: string;
		role?: string;
		"aria-label"?: string;
		"data-testid"?: string;
	}

	let {
		name,
		size = 24,
		filled = false,
		class: className = "shrink-0",
		style,
		role,
		"aria-label": ariaLabel,
		"data-testid": dataTestid,
	}: Props = $props();

	const icon = $derived(resolveHugeiconsIcon(name));
	const resolvedRole = $derived(ariaLabel ? (role ?? "img") : role);
	const ariaHidden = $derived(ariaLabel ? undefined : "true");
</script>

{#if filled}
	<HugeiconsRenderer
		icon={icon}
		{size}
		class={className}
		{style}
		role={resolvedRole}
		aria-label={ariaLabel}
		data-testid={dataTestid}
		aria-hidden={ariaHidden}
	/>
{:else}
	<HugeiconsRenderer
		icon={icon}
		{size}
		strokeWidth={1.75}
		class={className}
		{style}
		role={resolvedRole}
		aria-label={ariaLabel}
		data-testid={dataTestid}
		aria-hidden={ariaHidden}
	/>
{/if}
