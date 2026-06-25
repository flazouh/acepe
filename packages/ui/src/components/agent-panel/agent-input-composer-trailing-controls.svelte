<!--
  AgentInputComposerTrailingControls - Model slot, metrics, checkpoint, voice controls.
  Extracted from the former composer footer right cluster.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import AgentInputVoiceFusedControls from "./agent-input-voice-fused-controls.svelte";
	import { isVoiceActive } from "./agent-input-composer-toolbar-state.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
	import type { AgentComposerToolbarVoiceBinding } from "./agent-input-toolbar-voice.js";

	let {
		inputReady,
		modelSelector,
		metricsChip,
		agentProjectPicker,
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
		toolbarConfigOptions = [],
		onConfigOptionChange,
		selectorsLoading = false,
		selectorsDisabledByComposer = false,
	}: {
		inputReady: boolean;
		modelSelector: Snippet;
		metricsChip?: Snippet;
		agentProjectPicker?: Snippet;
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
		toolbarConfigOptions?: readonly AgentInputConfigOption[];
		onConfigOptionChange?: (configId: string, value: string) => void | Promise<void>;
		selectorsLoading?: boolean;
		selectorsDisabledByComposer?: boolean;
	} = $props();
</script>

{#if inputReady}
	{@const voiceActive = isVoiceActive(voiceState)}
	<div class="flex items-end gap-1 shrink-0">
		<div
			class="flex items-end gap-1 transition-opacity duration-200 ease-out"
			class:opacity-0={voiceActive}
			class:pointer-events-none={voiceActive}
		>
			{#if agentProjectPicker}
				<div class="flex shrink-0 items-end">
					{@render agentProjectPicker()}
				</div>
			{/if}
			{@render modelSelector()}
			{#if toolbarConfigOptions.length > 0 && onConfigOptionChange}
				<div class="flex shrink-0 items-end">
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
			{#if metricsChip}
				<div class="flex shrink-0 items-end">
					{@render metricsChip()}
				</div>
			{/if}
		</div>
		<AgentInputVoiceFusedControls
			{voiceState}
			{voiceEnabled}
			{composerIsDispatching}
			{getMicButtonTitle}
			{onVoiceMicKeyDown}
			{voiceModels}
			{voiceSelectedModelId}
			{voiceModelsLoading}
			{voiceDownloadingModelId}
			{voiceDownloadPercent}
			{voiceMenuLabel}
			{voiceModelsLoadingLabel}
			{onVoiceSelectModel}
			{onVoiceDownloadModel}
			{voiceCloseLabel}
		/>
	</div>
{/if}
