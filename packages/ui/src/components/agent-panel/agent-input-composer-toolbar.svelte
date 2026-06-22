<!--
  Composer footer: mode selector, model slot (host), config options, voice controls.
  Host supplies labels and desktop-only pieces (model selector, metrics) via snippets/props.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentInputAutonomousToggle from "./agent-input-autonomous-toggle.svelte";
	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import AgentInputMicButton from "./agent-input-mic-button.svelte";
	import AgentInputModeSelector from "./agent-input-mode-selector.svelte";
	import AgentInputVoiceModelMenu from "./agent-input-voice-model-menu.svelte";
	import { ButtonGroup } from "../button-group/index.js";
	import {
		isMicButtonDisabled,
		isToolbarLeftSideDisabled,
		isVoiceActive,
		isVoiceRecordingUi,
		shouldShowVoiceControls,
		shouldShowVoiceErrorDismiss,
		shouldShowVoiceRecordingBar,
	} from "./agent-input-composer-toolbar-state.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
	import {
		getMicButtonVisualState,
		type AgentComposerToolbarVoiceBinding,
	} from "./agent-input-toolbar-voice.js";

	let {
		inputReady,
		autonomousStatusMessage,
		autonomousToggleActive,
		autonomousDisabled,
		autonomousBusy,
		autonomousTooltip,
		onAutonomousToggle,
		modes = [],
		currentModeId = null,
		onModeChange,
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
		autonomousToggleActive: boolean;
		autonomousDisabled: boolean;
		autonomousBusy: boolean;
		autonomousTooltip?: string;
		onAutonomousToggle: () => void;
		modes?: readonly {
			id: string;
			name?: string;
			label?: string;
			description?: string | null;
			iconKind?: "agent" | "plan" | "autonomous" | "bypass" | "ask" | "edit" | "review" | "unknown";
		}[];
		currentModeId?: string | null;
		onModeChange?: (modeId: string) => void;
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

	const voiceControlGroupClass = "overflow-hidden rounded-md bg-accent/30";
</script>

{#if inputReady}
	{@const currentVoiceState = voiceState}
	{@const recordingUi = isVoiceRecordingUi(currentVoiceState)}
	{@const voiceActive = isVoiceActive(currentVoiceState)}
	<span class="sr-only" role="status" aria-live="polite">{autonomousStatusMessage}</span>
	<div
		class="flex items-center h-7 transition-opacity duration-200 ease-out"
		class:opacity-0={recordingUi}
		class:pointer-events-none={isToolbarLeftSideDisabled({
			isRecordingUi: recordingUi,
			selectorsDisabledByComposer,
		})}
	>
		{#if modes.length > 0 && onModeChange}
			<AgentInputModeSelector
				availableModes={modes}
				{currentModeId}
				autonomousActive={autonomousToggleActive}
				disabled={selectorsDisabledByComposer}
				onModeChange={onModeChange}
			/>
			<div class="h-full w-px bg-border/50"></div>
			<AgentInputAutonomousToggle
				active={autonomousToggleActive}
				disabled={autonomousDisabled || selectorsDisabledByComposer}
				busy={autonomousBusy}
				title={autonomousTooltip ?? "Auto-approve"}
				ariaLabel={autonomousTooltip ?? "Auto-approve"}
				tooltipDescription="Acepe auto-approves every permission request — file edits, commands, and other actions — without asking. Questions and plan reviews still surface."
				onToggle={onAutonomousToggle}
			/>
			<div class="h-full w-px bg-border/50"></div>
		{/if}
		{#if agentProjectPicker}
			<div class="flex h-7 shrink-0 items-center">
				{@render agentProjectPicker()}
			</div>
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
		<div class="h-full w-px bg-border/50"></div>
	</div>

	<div class="flex items-center h-7 ml-auto">
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
				class="flex items-center gap-1.5 transition-opacity duration-200 ease-out"
				class:opacity-0={voiceActive}
				class:pointer-events-none={voiceActive}
			>
				{#if metricsChip}
					{@render metricsChip()}
				{/if}
				{#if checkpointButton}
					{@render checkpointButton()}
				{/if}
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
					<ButtonGroup class={voiceControlGroupClass}>
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
					</ButtonGroup>
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
