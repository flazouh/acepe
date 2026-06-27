<!--
  AgentInputVoiceFusedControls - Mic/stop + optional recording timer + voice model overflow menu.
-->
<script lang="ts">
	import AgentInputMicButton from "./agent-input-mic-button.svelte";
	import AgentInputVoiceModelMenu from "./agent-input-voice-model-menu.svelte";
	import AgentInputVoiceRecordingLeading from "./agent-input-voice-recording-leading.svelte";
	import { FusedPrimaryOverflowGroup } from "../panel-header/index.js";
	import {
		isMicButtonDisabled,
		isVoiceRecordingUi,
		shouldShowVoiceControls,
		shouldShowVoiceErrorDismiss,
	} from "./agent-input-composer-toolbar-state.js";
	import {
		getMicButtonVisualState,
		type AgentComposerToolbarVoiceBinding,
	} from "./agent-input-toolbar-voice.js";

	let {
		voiceState,
		voiceEnabled,
		composerIsDispatching,
		getMicButtonTitle,
		onVoiceMicKeyDown,
		voiceModels,
		voiceSelectedModelId,
		voiceModelsLoading,
		voiceDownloadingModelId,
		voiceDownloadPercent,
		voiceMenuLabel,
		voiceModelsLoadingLabel,
		onVoiceSelectModel,
		onVoiceDownloadModel,
		voiceCloseLabel,
	}: {
		voiceState: AgentComposerToolbarVoiceBinding | null;
		voiceEnabled: boolean;
		composerIsDispatching: boolean;
		getMicButtonTitle: (voice: AgentComposerToolbarVoiceBinding) => string;
		onVoiceMicKeyDown: (event: KeyboardEvent, voice: AgentComposerToolbarVoiceBinding) => void;
		voiceModels: readonly {
			id: string;
			name: string;
			sizeBytes: number;
			isDownloaded: boolean;
		}[];
		voiceSelectedModelId: string | null;
		voiceModelsLoading: boolean;
		voiceDownloadingModelId: string | null;
		voiceDownloadPercent: number;
		voiceMenuLabel: string;
		voiceModelsLoadingLabel: string;
		onVoiceSelectModel: (modelId: string) => void;
		onVoiceDownloadModel: (modelId: string) => void;
		voiceCloseLabel: string;
	} = $props();

	const recordingUi = $derived(voiceState !== null && isVoiceRecordingUi(voiceState));
	const showVoiceControls = $derived(
		voiceState !== null && shouldShowVoiceControls({ voiceState, voiceEnabled })
	);
</script>

{#if showVoiceControls && voiceState !== null}
	{@const currentVoiceState = voiceState}
	{#if shouldShowVoiceErrorDismiss({ voiceState: currentVoiceState, voiceEnabled })}
		<button
			type="button"
			class="mr-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
			onclick={() => currentVoiceState.dismissError()}
		>
			{voiceCloseLabel}
		</button>
	{/if}
	<div class="voice-controls flex items-end">
		{#snippet recordingLeading()}
			<AgentInputVoiceRecordingLeading
				meterLevels={currentVoiceState.meterLevels}
				barCount={currentVoiceState.barCount}
				recordingElapsedTenths={currentVoiceState.recordingElapsedTenths}
			/>
		{/snippet}
		{#snippet micPrimary()}
			<AgentInputMicButton
				embeddedInGroup
				visualState={getMicButtonVisualState(currentVoiceState.phase)}
				downloadPercent={currentVoiceState.downloadPercent}
				title={getMicButtonTitle(currentVoiceState)}
				ariaLabel={getMicButtonTitle(currentVoiceState)}
				disabled={isMicButtonDisabled({ voiceState: currentVoiceState, composerIsDispatching })}
				onpointerdown={(event) => currentVoiceState.onMicPointerDown(event)}
				onpointerup={() => currentVoiceState.onMicPointerUp()}
				onpointercancel={() => currentVoiceState.onMicPointerCancel()}
				onkeydown={(event) => onVoiceMicKeyDown(event, currentVoiceState)}
			/>
		{/snippet}
		{#snippet voiceOverflow()}
			<AgentInputVoiceModelMenu
				embeddedInGroup
				models={voiceModels}
				selectedModelId={voiceSelectedModelId}
				modelsLoading={voiceModelsLoading}
				downloadingModelId={voiceDownloadingModelId}
				downloadPercent={voiceDownloadPercent}
				menuLabel={voiceMenuLabel}
				loadingLabel={voiceModelsLoadingLabel}
				onSelectModel={onVoiceSelectModel}
				onDownloadModel={onVoiceDownloadModel}
			/>
		{/snippet}
		<FusedPrimaryOverflowGroup
			leading={recordingUi ? recordingLeading : undefined}
			primary={micPrimary}
			overflow={voiceOverflow}
		/>
	</div>
{/if}
