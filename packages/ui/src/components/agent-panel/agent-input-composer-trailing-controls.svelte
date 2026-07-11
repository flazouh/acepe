<!--
  AgentInputComposerTrailingControls - Model slot, metrics, checkpoint, voice controls.
  Extracted from the former composer footer right cluster.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import AgentInputModelReasoningFusedControls from "./agent-input-model-reasoning-fused-controls.svelte";
	import AgentInputVoiceFusedControls from "./agent-input-voice-fused-controls.svelte";
	import { isReasoningConfigOption } from "./agent-input-config-option-selector-state.js";
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
		onVoiceUninstallModel,
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
		onVoiceUninstallModel: (modelId: string) => void;
		voiceCloseLabel: string;
		toolbarConfigOptions?: readonly AgentInputConfigOption[];
		onConfigOptionChange?: (configId: string, value: string) => void | Promise<void>;
		selectorsLoading?: boolean;
		selectorsDisabledByComposer?: boolean;
	} = $props();

	const fadeWhenVoiceActiveClass = $derived(
		isVoiceActive(voiceState) ? "pointer-events-none opacity-0" : "opacity-100"
	);

	const reasoningToolbarOption = $derived(
		toolbarConfigOptions.find((configOption) => isReasoningConfigOption(configOption)) ?? null
	);

	const otherToolbarConfigOptions = $derived(
		toolbarConfigOptions.filter((configOption) => !isReasoningConfigOption(configOption))
	);

	const fuseModelWithReasoning = $derived(reasoningToolbarOption !== null && onConfigOptionChange !== undefined);
</script>

{#if inputReady}
	<div
		class="flex min-w-0 max-w-full items-end justify-end gap-0.5"
		data-qa="agent-input-trailing-controls"
	>
		{#if agentProjectPicker}
			<div
				class="shrink-0 transition-opacity duration-200 ease-out {fadeWhenVoiceActiveClass}"
			>
				{@render agentProjectPicker()}
			</div>
		{/if}
		<div
			class="min-w-0 max-w-full shrink overflow-hidden transition-opacity duration-200 ease-out
				[&_[role=group]]:!min-w-0 [&_[role=group]]:!max-w-full
				[&_[data-slot=button]]:!min-w-0 [&_[data-slot=button]]:!max-w-full
				{fadeWhenVoiceActiveClass}"
			data-qa="agent-input-model-control"
		>
			{#if fuseModelWithReasoning && reasoningToolbarOption && onConfigOptionChange}
				<AgentInputModelReasoningFusedControls
					{modelSelector}
					reasoningConfigOption={reasoningToolbarOption}
					disabled={selectorsLoading || selectorsDisabledByComposer}
					onConfigOptionChange={(configId, value) => {
						void onConfigOptionChange(configId, value);
					}}
				/>
			{:else}
				{@render modelSelector()}
			{/if}
		</div>
		{#if otherToolbarConfigOptions.length > 0 && onConfigOptionChange}
			{#each otherToolbarConfigOptions as configOption (configOption.id)}
				<div
					class="shrink-0 transition-opacity duration-200 ease-out {fadeWhenVoiceActiveClass}"
				>
					<AgentInputConfigOptionSelector
						{configOption}
						onValueChange={(configId, value) => {
							void onConfigOptionChange(configId, value);
						}}
						disabled={selectorsLoading || selectorsDisabledByComposer}
					/>
				</div>
			{/each}
		{/if}
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
			{onVoiceUninstallModel}
			{voiceCloseLabel}
		/>
		{#if metricsChip}
			<div class="shrink-0 transition-opacity duration-200 ease-out {fadeWhenVoiceActiveClass}">
				{@render metricsChip()}
			</div>
		{/if}
	</div>
{/if}
