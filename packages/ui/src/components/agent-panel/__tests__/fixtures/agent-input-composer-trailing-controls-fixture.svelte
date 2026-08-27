<script lang="ts">
	import AgentInputComposerTrailingControls from "../../agent-input-composer-trailing-controls.svelte";
	import type { AgentComposerToolbarVoiceBinding } from "../../agent-input-toolbar-voice.js";

	interface Props {
		voiceActive?: boolean;
		showMetrics?: boolean;
	}

	let { voiceActive = false, showMetrics = true }: Props = $props();

	const voiceState = $derived.by((): AgentComposerToolbarVoiceBinding | null => {
		if (!voiceActive) {
			return null;
		}
		return {
			phase: "recording",
			recordingElapsedTenths: 0,
			downloadPercent: 0,
			meterLevels: [],
			barCount: 0,
			onMicPointerDown: () => undefined,
			onMicPointerUp: () => undefined,
			onMicPointerCancel: () => undefined,
			dismissError: () => undefined,
		};
	});
</script>

{#snippet metricsChip()}
	{#if showMetrics}
		<span>42%</span>
	{/if}
{/snippet}

<AgentInputComposerTrailingControls
	inputReady={true}
	{metricsChip}
	{voiceState}
	voiceEnabled={true}
	composerIsDispatching={false}
	getMicButtonTitle={() => ""}
	onVoiceMicKeyDown={() => undefined}
	voiceCloseLabel="Close"
/>
