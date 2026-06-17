<!--
  AgentToolDurationLabel - Animated seconds label for tool call durations.
-->
<script lang="ts">
	import AnimateNumber from "../animate-number/animate-number.svelte";
	import { toolDurationClock } from "./tool-duration-clock.js";
	import {
		resolveToolDurationAnimateValue,
		type ToolDurationTiming,
	} from "./tool-duration.js";

	interface Props {
		timing?: ToolDurationTiming | null;
		class?: string;
		duration?: number;
		blur?: number;
		/** Optional prefix before the animated value (e.g. "for"). */
		prefix?: string | null;
	}

	let {
		timing = null,
		class: className = "shrink-0 font-sans text-sm",
		duration = 450,
		blur = 14,
		prefix = null,
	}: Props = $props();

	const display = $derived(
		timing
			? resolveToolDurationAnimateValue({
					startedAtMs: timing.startedAtMs,
					completedAtMs: timing.completedAtMs,
					status: timing.status,
					nowMs: $toolDurationClock,
				})
			: null
	);
</script>

{#if display}
	<span
		class="{className} inline-flex items-baseline gap-1"
		data-testid="agent-tool-duration-label"
	>
		{#if prefix}
			<span>{prefix}</span>
		{/if}
		<AnimateNumber
			value={display.value}
			format={{
				minimumFractionDigits: display.minimumFractionDigits,
				maximumFractionDigits: display.maximumFractionDigits,
			}}
			{duration}
			{blur}
			class="font-medium"
		/>
	</span>
{/if}
