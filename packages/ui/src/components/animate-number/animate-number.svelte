<!--
  AnimateNumber — digit-by-digit iOS-spring animation with blur on changed digits.
  Ported from https://github.com/serafimcloud/animated-blur-number (MIT).
-->
<script lang="ts">
	import { untrack } from "svelte";

	import { onMount } from "svelte";

	import CharSlot from "./char-slot.svelte";

	interface Props {
		value: number;
		format?: Intl.NumberFormatOptions;
		locale?: string;
		prefix?: string;
		suffix?: string;
		duration?: number;
		blur?: number;
		class?: string;
	}

	let {
		value,
		format = undefined,
		locale = "en-US",
		prefix = undefined,
		suffix = undefined,
		duration = 450,
		blur = 21,
		class: className = "",
	}: Props = $props();

	const STYLES = `
.an-root {
  --an-spring: linear(
    0, 0.028 2.5%, 0.0995 5%, 0.198 7.5%, 0.3106 10%, 0.4272 12.5%, 0.5405 15%,
    0.6454 17.5%, 0.7387 20%, 0.819 22.5%, 0.8856 25%, 0.9391 27.5%, 0.9803 30%,
    1.0107 32.5%, 1.0317 35%, 1.045 37.5%, 1.052 40%, 1.0543 42.5%, 1.053 45%,
    1.0493 47.5%, 1.044 50%, 1.0379 52.5%, 1.0316 55%, 1.0254 57.5%, 1.0197 60%,
    1.0146 62.5%, 1.0102 65%, 1.0065 67.5%, 1.0035 70%, 1.0012 72.5%, 0.9995 75%,
    0.9984 77.5%, 0.9976 80%, 0.9972 82.5%, 0.9971 85%, 0.9971 87.5%, 0.9973 90%,
    0.9976 92.5%, 0.9979 95%, 0.9983 97.5%, 1
  );
  --an-dist: 0.55em;
  display: inline-flex;
  align-items: baseline;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.an-slot { position: relative; display: inline-block; }
.an-layer { display: inline-block; opacity: 1; will-change: transform, opacity, filter; }
.an-out { position: absolute; inset: 0; }
.an-in {
  animation:
    an-slide-in var(--an-dur, 450ms) var(--an-spring) both,
    an-resolve  var(--an-dur, 450ms) cubic-bezier(0.22, 1, 0.36, 1) both;
}
.an-out {
  animation:
    an-slide-out var(--an-dur, 450ms) cubic-bezier(0.4, 0, 1, 1) both,
    an-dissolve  var(--an-dur, 450ms) cubic-bezier(0.4, 0, 1, 1) both;
}
@keyframes an-slide-in  { from { transform: translateY(calc(var(--an-dir,1)*var(--an-dist))); } to { transform: translateY(0); } }
@keyframes an-slide-out { from { transform: translateY(0); } to { transform: translateY(calc(var(--an-dir,1)*var(--an-dist)*-1)); } }
@keyframes an-resolve   { from { opacity:0; filter: blur(var(--an-blur,21px)); } to { opacity:1; filter:blur(0); } }
@keyframes an-dissolve  { from { opacity:1; filter:blur(0); } to { opacity:0; filter:blur(var(--an-blur,21px)); } }
@media (prefers-reduced-motion: reduce) {
  .an-in  { animation: none; }
  .an-out { animation: none; display: none; }
}
.an-sr {
  position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;
}`;

	onMount(() => {
		if (typeof document === "undefined") return;
		if (document.getElementById("animate-number-styles")) return;
		const el = document.createElement("style");
		el.id = "animate-number-styles";
		el.textContent = STYLES;
		document.head.prepend(el);
	});

	function formatValue(v: number): string {
		try {
			return new Intl.NumberFormat(locale, format).format(v);
		} catch {
			return String(v);
		}
	}

	const formatted = $derived(formatValue(value));
	const chars = $derived(formatted.split(""));
	const ariaLabel = $derived(
		[prefix ?? "", formatted, suffix ?? ""].join("")
	);

	let direction = $state(1);
	let prevValue = untrack(() => value);

	$effect(() => {
		const next = value;
		if (next === prevValue) {
			return;
		}
		direction = next < prevValue ? -1 : 1;
		prevValue = next;
	});
</script>

<span class="an-root {className}" aria-label={ariaLabel}>
	<span class="an-sr">{ariaLabel}</span>
	{#if prefix != null}
		<span aria-hidden="true">{prefix}</span>
	{/if}
	{#each chars as ch, index (chars.length - 1 - index)}
		<CharSlot char={ch} {direction} duration={duration} {blur} />
	{/each}
	{#if suffix != null}
		<span aria-hidden="true">{suffix}</span>
	{/if}
</span>
