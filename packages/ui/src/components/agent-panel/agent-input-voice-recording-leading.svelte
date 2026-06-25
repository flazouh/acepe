<!--
  AgentInputVoiceRecordingLeading - Meter + elapsed timer for the fused voice toolbar left segment.
-->
<script lang="ts">
	import AgentInputVoiceRecordingElapsed from "./agent-input-voice-recording-elapsed.svelte";
	import AgentInputVoiceRecordingMeter from "./agent-input-voice-recording-meter.svelte";

	interface Props {
		meterLevels: readonly number[];
		barCount: number;
		recordingElapsedTenths: number | null;
	}

	let { meterLevels, barCount, recordingElapsedTenths }: Props = $props();
</script>

<div class="flex items-center gap-1.5">
	<AgentInputVoiceRecordingMeter {meterLevels} {barCount} />
	{#if recordingElapsedTenths !== null}
		<AgentInputVoiceRecordingElapsed tenths={recordingElapsedTenths} />
	{/if}
</div>
