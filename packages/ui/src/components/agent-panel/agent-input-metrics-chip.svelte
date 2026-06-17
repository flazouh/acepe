<!--
  AgentInputMetricsChip - Circular progress ring + animated blur-number percentage.

  Visual: a small SVG ring that fills clockwise as context is consumed,
  with the numeric percentage rendered to its right using the digit-by-digit
  blur-spring animation (port of animated-blur-number, MIT).
-->
<script lang="ts">
	import AnimateNumber from "../animate-number/animate-number.svelte";

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
		compact = false,
		hideLabel: _hideLabel = false,
		ariaLabel = "Context usage",
		title = "",
	}: Props = $props();

	const hasContextUsage = $derived(percent !== null);

	// Ring geometry — RING_PX is both the SVG element size and the painted outer diameter.
	const RING_PX = $derived(compact ? 14 : 19);
	const STROKE = $derived(compact ? 1.5 : 2);
	// Inset radius so stroke + round caps fit inside RING_PX without bleeding past the SVG box.
	const R = $derived(RING_PX / 2 - STROKE);
	const CENTER = $derived(RING_PX / 2);
	const CIRC = $derived(2 * Math.PI * R);
	const pct = $derived(Math.min(100, Math.max(0, percent ?? 0)));
	const dashOffset = $derived(CIRC * (1 - pct / 100));

	const isCritical = $derived(pct >= 80);
	const ringColor = $derived(
		pct >= 80 ? "hsl(var(--destructive))" : "currentColor"
	);
</script>

{#if hasContextUsage}
	<div
		class="flex items-center gap-1 text-muted-foreground {compact ? 'h-5 text-[10px]' : 'h-7 text-[11px]'}"
		role="status"
		aria-label="{ariaLabel}: {pct.toFixed(1)}%"
		{title}
	>
		<!-- Circular ring -->
		<svg
			width={RING_PX}
			height={RING_PX}
			viewBox="0 0 {RING_PX} {RING_PX}"
			aria-hidden="true"
			class="shrink-0"
			style="color: {ringColor};"
		>
			<!-- Track -->
			<circle
				cx={CENTER}
				cy={CENTER}
				r={R}
				fill="none"
				stroke="currentColor"
				stroke-width={STROKE}
				opacity="0.18"
			/>
			<!-- Fill -->
			<circle
				cx={CENTER}
				cy={CENTER}
				r={R}
				fill="none"
				stroke="currentColor"
				stroke-width={STROKE}
				stroke-dasharray={CIRC}
				stroke-dashoffset={dashOffset}
				stroke-linecap="round"
				transform="rotate(-90 {CENTER} {CENTER})"
				style="transition: stroke-dashoffset 600ms cubic-bezier(0.4, 0, 0.2, 1), stroke 300ms ease;"
			/>
		</svg>

		<!-- Animated percent number -->
		<AnimateNumber
			value={pct}
			format={{ maximumFractionDigits: 0 }}
			suffix="%"
			duration={450}
			blur={14}
			class="font-mono font-medium leading-none {isCritical ? 'text-destructive' : 'text-muted-foreground'}"
		/>
	</div>
{/if}
