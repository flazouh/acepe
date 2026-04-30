<!--
  Composer footer: mode selector, model slot (host), config options, voice controls.
  Host supplies labels and desktop-only pieces (model selector, metrics) via snippets/props.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import AgentInputMicButton from "./agent-input-mic-button.svelte";
	import AgentInputModeSelector from "./agent-input-mode-selector.svelte";
	import AgentInputVoiceModelMenu from "./agent-input-voice-model-menu.svelte";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
	import {
		canCancelVoiceInteraction,
		canStartVoiceInteraction,
		getMicButtonVisualState,
		type AgentComposerToolbarVoiceBinding,
	} from "./agent-input-toolbar-voice.js";

	let {
		inputReady,
		autonomousStatusMessage,
		visibleModes,
		selectedModeMenuOptionId,
		autonomousToggleActive,
		autoModeDisabled,
		autoModeDisabledReason,
		planModeLabel,
		buildModeLabel,
		autoModeLabel = "Auto",
		onModeMenuChange,
		selectorsLoading,
		selectorsDisabledByComposer,
		toolbarConfigOptions,
		onConfigOptionChange,
		modelSelector,
		agentProjectPicker,
		metricsChip,
		checkpointButton,
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
		autonomousStatusMessage: string;
		visibleModes: readonly { id: string; label?: string; description?: string | null }[];
		selectedModeMenuOptionId: string | null;
		autonomousToggleActive: boolean;
		autoModeDisabled: boolean;
		autoModeDisabledReason: string | null;
		planModeLabel: string;
		buildModeLabel: string;
		autoModeLabel?: string;
		onModeMenuChange: (modeId: string) => void | Promise<void>;
		selectorsLoading: boolean;
		selectorsDisabledByComposer: boolean;
		toolbarConfigOptions: readonly AgentInputConfigOption[];
		onConfigOptionChange: (configId: string, value: string) => void | Promise<void>;
		modelSelector: Snippet;
		agentProjectPicker: Snippet | undefined;
		metricsChip: Snippet | undefined;
		checkpointButton: Snippet | undefined;
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
	{@const isVoiceRecordingUi =
		currentVoiceState !== null &&
		(currentVoiceState.phase === "checking_permission" || currentVoiceState.phase === "recording")}
	{@const isVoiceActive =
		currentVoiceState !== null &&
		currentVoiceState.phase !== "idle" &&
		currentVoiceState.phase !== "error"}
	<span class="sr-only" role="status" aria-live="polite">{autonomousStatusMessage}</span>
	<div
		class="flex items-center h-7 transition-opacity duration-200 ease-out"
		class:opacity-0={isVoiceRecordingUi}
		class:pointer-events-none={isVoiceRecordingUi || selectorsDisabledByComposer}
	>
		{#if visibleModes.length > 0}
			<AgentInputModeSelector
				availableModes={visibleModes}
				currentModeId={selectedModeMenuOptionId}
				planLabel={planModeLabel}
				buildLabel={buildModeLabel}
				autoLabel={autoModeLabel}
				autonomousActive={autonomousToggleActive}
				autoDisabled={autoModeDisabled}
				autoDisabledReason={autoModeDisabledReason}
				onModeChange={(modeId) => {
					void onModeMenuChange(modeId);
				}}
			/>
			<div class="h-full w-px bg-border/50"></div>
		{:else if selectorsLoading}
			<div class="h-7 w-7 rounded-md bg-muted/80 animate-pulse" aria-hidden="true"></div>
			<div class="h-full w-px bg-border/50"></div>
		{/if}
		{@render modelSelector()}
		{#if toolbarConfigOptions.length > 0}
			<div class="h-full w-px bg-border/50"></div>
			<div class="flex items-center">
				{#each toolbarConfigOptions as configOption (configOption.id)}
					<AgentInputConfigOptionSelector
						{configOption}
						onValueChange={(configId, value) => {
							void onConfigOptionChange(configId, value);
						}}
						disabled={selectorsLoading || selectorsDisabledByComposer}
					/>
				{/each}
			</div>
		{/if}
		{#if agentProjectPicker}
			<div class="h-full w-px bg-border/50"></div>
			{@render agentProjectPicker()}
		{/if}
		<div class="h-full w-px bg-border/50"></div>
	</div>

	<div class="flex items-center h-7 ml-auto">
		{#if currentVoiceState !== null && isVoiceRecordingUi}
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
					disabled={
						!canStartVoiceInteraction(currentVoiceState.phase, composerIsDispatching) &&
						!canCancelVoiceInteraction(currentVoiceState.phase)
					}
					onpointerdown={(event) => currentVoiceState.onMicPointerDown(event)}
					onpointerup={() => currentVoiceState.onMicPointerUp()}
					onpointercancel={() => currentVoiceState.onMicPointerCancel()}
					onkeydown={(event) => onVoiceMicKeyDown(event, currentVoiceState)}
				/>
			</div>
		{:else}
			<div
				class="flex items-center gap-1.5 transition-opacity duration-200 ease-out"
				class:opacity-0={isVoiceActive}
				class:pointer-events-none={isVoiceActive}
			>
				{#if metricsChip}
					{@render metricsChip()}
				{/if}
				{#if checkpointButton}
					{@render checkpointButton()}
				{/if}
			</div>
			{#if currentVoiceState !== null && voiceEnabled}
				{#if currentVoiceState.phase === "error"}
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
						disabled={
							!canStartVoiceInteraction(currentVoiceState.phase, composerIsDispatching) &&
							!canCancelVoiceInteraction(currentVoiceState.phase)
						}
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
