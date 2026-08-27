<!--
  AgentInputComposerTrailingControls - Project picker, remaining config options,
  voice and metrics at the composer's trailing edge.

  Mode, model and reasoning live in AgentInputComposerLeadingControls.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import { AGENT_INPUT_CONTROL_GAP_CLASS } from "./agent-input-composer-spacing.js";
	import AgentInputVoiceFusedControls from "./agent-input-voice-fused-controls.svelte";
	import { partitionToolbarConfigOptions } from "./agent-input-config-option-selector-state.js";
	import { isVoiceActive } from "./agent-input-composer-toolbar-state.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
	import type { AgentComposerToolbarVoiceBinding } from "./agent-input-toolbar-voice.js";

	let {
		inputReady,
		metricsChip,
		agentProjectPicker,
		voiceState,
		voiceEnabled,
		composerIsDispatching,
		getMicButtonTitle,
		micShortcut = [],
		onVoiceMicKeyDown,
		voiceCloseLabel,
		toolbarConfigOptions = [],
		onConfigOptionChange,
		selectorsLoading = false,
		selectorsDisabledByComposer = false,
	}: {
		inputReady: boolean;
		metricsChip?: Snippet;
		agentProjectPicker?: Snippet;
		voiceState: AgentComposerToolbarVoiceBinding | null;
		voiceEnabled: boolean;
		composerIsDispatching: boolean;
		getMicButtonTitle: (voice: AgentComposerToolbarVoiceBinding) => string;
		micShortcut?: readonly string[];
		onVoiceMicKeyDown: (event: KeyboardEvent, voice: AgentComposerToolbarVoiceBinding) => void;
		voiceCloseLabel: string;
		toolbarConfigOptions?: readonly AgentInputConfigOption[];
		onConfigOptionChange?: (configId: string, value: string) => void | Promise<void>;
		selectorsLoading?: boolean;
		selectorsDisabledByComposer?: boolean;
	} = $props();

	const fadeWhenVoiceActiveClass = $derived(
		isVoiceActive(voiceState) ? "pointer-events-none opacity-0" : "opacity-100"
	);

	/** Reasoning is fused to the model in the leading cluster, so it is not repeated here. */
	const otherToolbarConfigOptions = $derived(
		partitionToolbarConfigOptions(toolbarConfigOptions).others
	);
</script>

{#if inputReady}
	<div
		class="flex min-w-0 max-w-full items-end justify-end {AGENT_INPUT_CONTROL_GAP_CLASS}"
		data-qa="agent-input-trailing-controls"
	>
		{#if agentProjectPicker}
			<div
				class="shrink-0 transition-opacity duration-200 ease-out {fadeWhenVoiceActiveClass}"
			>
				{@render agentProjectPicker()}
			</div>
		{/if}
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
			{micShortcut}
			{onVoiceMicKeyDown}
			{voiceCloseLabel}
		/>
		{#if metricsChip}
			<div class="shrink-0 empty:hidden" data-qa="agent-input-metrics-chip">{@render metricsChip()}</div>
		{/if}
	</div>
{/if}
