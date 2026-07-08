<!--
  AgentInputMetricsChip - Vertical fuel-gauge fill + animated blur-number percentage.

  Visual: a small vertical meter (matching the usage widget's fuel gauge) that
  fills from the bottom as context is consumed, with the numeric percentage
  rendered to its right using the digit-by-digit blur-spring animation
  (port of animated-blur-number, MIT). Sized to sit alongside the mic button.
-->
<script lang="ts">
	import AnimateNumber from "../animate-number/animate-number.svelte";
	import { buttonVariants } from "../button/variants.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		/** Pre-formatted primary label (e.g., "2m/200k" or "$0.42"). Unused visually but kept for compat. */
		label?: string | null;
		/** Context usage 0-100. null hides the chip entirely. */
		percent?: number | null;
		compact?: boolean;
		hideLabel?: boolean;
		ariaLabel?: string;
		title?: string;
	}

	let {
		label: _label = null,
		percent = null,
		compact: _compact = false,
		hideLabel: _hideLabel = false,
		ariaLabel = "Context usage",
		title = "",
	}: Props = $props();

	const hasContextUsage = $derived(percent !== null);
	const pct = $derived(Math.min(100, Math.max(0, percent ?? 0)));

	// Fuel-gauge geometry — a vertical bar that fills from the bottom, mirroring
	// the usage widget's vertical meter. The track is centered within a
	// mic-button-sized (26px) row so the chip reads as a sibling of the mic.
	const TRACK_PX = 16;
	// Usable fill height = track minus the 1px inset padding on top and bottom.
	const INNER_PX = TRACK_PX - 4;
	const fillHeightPx = $derived(Math.max(2, Math.round((INNER_PX * pct) / 100)));

	// Tone escalates with pressure, like the usage fuel gauge: neutral → watch → critical.
	const isCritical = $derived(pct >= 80);
	const isWatch = $derived(pct >= 60 && pct < 80);
	const fillClass = $derived(
		isCritical
			? "bg-[#ff3b30] dark:bg-[#ff453a]"
			: isWatch
				? "bg-[#ff9500] dark:bg-[#ff9f0a]"
				: "bg-foreground/55"
	);
	const numberToneClass = $derived(
		isCritical
			? "text-destructive"
			: isWatch
				? "text-amber-600 dark:text-amber-400"
				: "text-muted-foreground"
	);
	const shellClass = $derived(
		cn(
			buttonVariants({ variant: "secondary", size: "sm" }),
			"h-7 min-h-7 min-w-[46px] cursor-default select-none gap-1.5 px-2 font-mono text-[10px] shadow-none hover:bg-secondary"
		)
	);
</script>

{#if hasContextUsage}
	<div
		class={shellClass}
		role="status"
		aria-label="{ariaLabel}: {pct.toFixed(1)}%"
		{title}
	>
		<!-- Vertical fill meter (fuel gauge) -->
		<div
			class="relative w-[9px] shrink-0 overflow-hidden rounded-[3px] border border-foreground/35 bg-transparent p-px"
			style:height={`${TRACK_PX}px`}
			aria-hidden="true"
		>
			<div
				class="absolute bottom-px left-px right-px min-h-[2px] rounded-[1.5px] transition-[height] duration-500 ease-out {fillClass}"
				style:height={`${fillHeightPx}px`}
			></div>
		</div>

		<!-- Animated percent number -->
		<AnimateNumber
			value={pct}
			format={{ maximumFractionDigits: 0 }}
			suffix="%"
			duration={450}
			blur={14}
			class="min-w-[2.2ch] text-right font-mono font-medium leading-none {numberToneClass}"
		/>
	</div>
{/if}
