<script lang="ts">
	import { clampPercent } from "./usage-widget-state.js";
	import UsageAgentIcon from "./usage-agent-icon.svelte";
	import type { ProviderBrand } from "../provider-mark/index.js";

	interface Props {
		label?: string | null;
		providerBrand?: ProviderBrand | null;
		providerName?: string | null;
		initials?: string | null;
		percent: number;
		fillClass: string;
		ariaLabel: string;
	}

	let {
		label = null,
		providerBrand = null,
		providerName = null,
		initials = null,
		percent,
		fillClass,
		ariaLabel,
	}: Props = $props();

	const clampedPercent = $derived(clampPercent(percent));
	const fillHeightPx = $derived(Math.max(3, Math.round(12 * (clampedPercent / 100))));
	const hasAgentIcon = $derived(providerBrand !== null || providerName !== null || initials !== null);
	const labelCharacters = $derived(
		Array.from((label ?? "").trim().slice(0, 3).toUpperCase()).filter(
			(character) => character.length > 0
		)
	);
</script>

<div
	class="flex h-4 shrink-0 items-center gap-1"
	data-usage-vertical-meter
	aria-label={ariaLabel}
>
	{#if hasAgentIcon}
		<UsageAgentIcon
			providerBrand={providerBrand}
			providerName={providerName ?? label ?? "AI"}
			initials={initials ?? ""}
			class="opacity-90"
		/>
	{:else if labelCharacters.length > 0}
		<span
			class="flex h-3.5 w-[13px] shrink-0 items-center justify-center font-mono text-[8px] font-semibold leading-none text-muted-foreground"
			aria-hidden="true"
			data-usage-meter-label
		>
			{labelCharacters.join("")}
		</span>
	{/if}

	<div
		class="relative h-4 w-[9px] overflow-hidden rounded-[3px] border border-foreground/35 bg-transparent p-px"
		role="progressbar"
		aria-label={ariaLabel}
		aria-valuenow={clampedPercent}
		aria-valuemin={0}
		aria-valuemax={100}
	>
		<div
			class="absolute bottom-px left-px right-px min-h-[3px] rounded-[1.5px] transition-[height] duration-500 ease-out {fillClass}"
			style:height={`${fillHeightPx}px`}
		></div>
	</div>
</div>
