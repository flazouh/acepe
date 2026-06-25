<!--
  AgentInputVoiceRecordingMeter - Compact live waveform bars for the fused voice toolbar.
-->
<script lang="ts">
	interface Props {
		meterLevels?: readonly number[];
		barCount?: number;
	}

	let {
		meterLevels = [],
		barCount = 0,
	}: Props = $props();

	const resolvedLevels = $derived.by(() => {
		if (meterLevels.length > 0) {
			return meterLevels;
		}

		if (barCount > 0) {
			return new Array(barCount).fill(0.08);
		}

		return [];
	});
</script>

{#if resolvedLevels.length > 0}
	<div class="voice-meter flex items-center gap-[1px] motion-reduce:hidden" aria-hidden="true">
		{#each resolvedLevels as level, index (index)}
			{@const dist = Math.abs(index - Math.floor(resolvedLevels.length / 2))}
			{@const maxHeight = Math.max(4, 12 - dist * 1.2)}
			{@const height = 2 + level * (maxHeight - 2)}
			<div
				class="voice-bar rounded-full"
				class:voice-bar-active={level > 0.02}
				style:width="2px"
				style:height="{height}px"
			></div>
		{/each}
	</div>
{/if}

<style>
	.voice-meter {
		min-height: 12px;
		align-items: center;
	}

	.voice-bar {
		background-color: color-mix(in oklab, var(--success) 35%, transparent);
		transition:
			height 90ms linear,
			background-color 120ms linear;
	}

	.voice-bar-active {
		background-color: var(--success);
	}
</style>
