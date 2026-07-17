<script lang="ts">
	import AgentInputComposerTrailingControls from "../../agent-input-composer-trailing-controls.svelte";
	import type { AgentComposerToolbarVoiceBinding } from "../../agent-input-toolbar-voice.js";

	interface Props {
		voiceActive?: boolean;
	}

	let { voiceActive = false }: Props = $props();

	const voiceModels: readonly {
		id: string;
		name: string;
		sizeBytes: number;
		isDownloaded: boolean;
	}[] = [];

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

{#snippet modelSelector()}
	<button type="button">Sonnet · github-copilot-claude-sonnet-4-6</button>
{/snippet}

{#snippet metricsChip()}
	<span>42%</span>
{/snippet}

<AgentInputComposerTrailingControls
	inputReady={true}
	{modelSelector}
	{metricsChip}
	{voiceState}
	voiceEnabled={true}
	composerIsDispatching={false}
	getMicButtonTitle={() => ""}
	onVoiceMicKeyDown={() => undefined}
	{voiceModels}
	voiceSelectedModelId={null}
	voiceModelsLoading={false}
	voiceDownloadingModelId={null}
	voiceDownloadPercent={0}
	voiceMenuLabel="Voice model"
	voiceModelsLoadingLabel="Loading voice models"
	onVoiceSelectModel={() => undefined}
	onVoiceDownloadModel={() => undefined}
	onVoiceUninstallModel={() => undefined}
	voiceCloseLabel="Close"
/>
