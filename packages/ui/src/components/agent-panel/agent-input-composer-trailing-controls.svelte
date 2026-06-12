<!--
  AgentInputComposerTrailingControls - Model slot, metrics, checkpoint, voice controls.
  Extracted from the former composer footer right cluster.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentInputMicButton from "./agent-input-mic-button.svelte";
	import AgentInputVoiceModelMenu from "./agent-input-voice-model-menu.svelte";
	import {
		isMicButtonDisabled,
		isVoiceActive,
		isVoiceRecordingUi,
		shouldShowVoiceControls,
		shouldShowVoiceErrorDismiss,
		shouldShowVoiceRecordingBar,
	} from "./agent-input-composer-toolbar-state.js";
	import {
		getMicButtonVisualState,
		type AgentComposerToolbarVoiceBinding,
	} from "./agent-input-toolbar-voice.js";

	let {
		inputReady,
		modelSelector,
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
		inputReady: boolean;
		modelSelector: Snippet;
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
</script>

{#if inputReady}
	{@const currentVoiceState = voiceState}
	{@const recordingUi = isVoiceRecordingUi(currentVoiceState)}
	{@const voiceActive = isVoiceActive(currentVoiceState)}
	<div class="flex items-end gap-1 shrink-0">
		{#if currentVoiceState !== null && shouldShowVoiceRecordingBar(currentVoiceState)}
			<div class="voice-recording-bar flex items-center pr-0.5">
				{#if currentVoiceState.recordingElapsedLabel}
					<span class="mr-2 font-mono text-sm text-muted-foreground tabular-nums">
						{currentVoiceState.recordingElapsedLabel}
					</span>
				{/if}
				<AgentInputMicButton
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
			</div>
		{:else}
			<div
				class="flex items-center gap-1 transition-opacity duration-200 ease-out"
				class:opacity-0={voiceActive}
				class:pointer-events-none={voiceActive}
			>
				{@render modelSelector()}
			</div>
			{#if currentVoiceState !== null && shouldShowVoiceControls({ voiceState: currentVoiceState, voiceEnabled, isRecordingUi: recordingUi })}
				{#if shouldShowVoiceErrorDismiss({ voiceState: currentVoiceState, voiceEnabled })}
					<button
						type="button"
						class="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline mr-1"
						onclick={() => currentVoiceState.dismissError()}
					>
						{voiceCloseLabel}
					</button>
				{/if}
				<div class="voice-controls flex items-center">
					<AgentInputVoiceModelMenu
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
					<AgentInputMicButton
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
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.voice-recording-bar {
		animation: voice-bar-enter 180ms ease-out;
	}

	@keyframes voice-bar-enter {
		from {
			opacity: 0;
			transform: translateX(8px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
</style>
