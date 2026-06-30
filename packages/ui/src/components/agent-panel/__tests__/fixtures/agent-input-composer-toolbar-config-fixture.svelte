<script lang="ts">
	import AgentInputComposerToolbar from "../../agent-input-composer-toolbar.svelte";
	import type { AgentInputConfigOption } from "../../agent-input-config-option-types.js";

	const configOptions: readonly AgentInputConfigOption[] = [
		{
			id: "reasoning",
			name: "Reasoning",
			category: "reasoning",
			type: "string",
			currentValue: "medium",
			presentation: "compactReasoning",
			options: [
				{ value: "low", name: "Low" },
				{ value: "medium", name: "Medium" },
			],
		},
	];
</script>

<AgentInputComposerToolbar
	inputReady={true}
	autonomousStatusMessage=""
	autonomousToggleActive={false}
	autonomousDisabled={false}
	autonomousBusy={false}
	onAutonomousToggle={() => {}}
	modes={[]}
	currentModeId={null}
	selectorsLoading={true}
	selectorsDisabledByComposer={false}
	toolbarConfigOptions={configOptions}
	onConfigOptionChange={() => {}}
	agentProjectPicker={undefined}
	metricsChip={undefined}
	checkpointButton={undefined}
	voiceState={null}
	voiceEnabled={false}
	composerIsDispatching={false}
	getMicButtonTitle={() => ""}
	onVoiceMicKeyDown={() => {}}
	voiceModels={[]}
	voiceSelectedModelId={null}
	voiceModelsLoading={false}
	voiceDownloadingModelId={null}
	voiceDownloadPercent={0}
	voiceMenuLabel="Voice model"
	voiceModelsLoadingLabel="Loading voice models"
	onVoiceSelectModel={() => {}}
	onVoiceDownloadModel={() => {}}
	onVoiceUninstallModel={() => {}}
	voiceCloseLabel="Close"
>
	{#snippet modelSelector()}
		<span data-testid="model-selector">Model</span>
	{/snippet}
</AgentInputComposerToolbar>
