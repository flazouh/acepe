<script lang="ts">
	import AgentInputComposerTrailingControls from "../../agent-input-composer-trailing-controls.svelte";

	const voiceModels: readonly {
		id: string;
		name: string;
		sizeBytes: number;
		isDownloaded: boolean;
	}[] = [];
</script>

{#snippet modelSelector()}
	<button type="button">Sonnet · github-copilot-claude-sonnet-4-6</button>
{/snippet}

<AgentInputComposerTrailingControls
	inputReady={true}
	{modelSelector}
	voiceState={null}
	voiceEnabled={false}
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
