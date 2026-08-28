<!--
  AgentInputVoiceFusedControls - Mic/stop + optional recording timer.
-->
<script lang="ts">
	import AgentInputMicButton from "./agent-input-mic-button.svelte";
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
		micShortcut = [],
		onVoiceMicKeyDown,
		voiceCloseLabel,
	}: {
		voiceState: AgentComposerToolbarVoiceBinding | null;
		voiceEnabled: boolean;
		composerIsDispatching: boolean;
		getMicButtonTitle: (voice: AgentComposerToolbarVoiceBinding) => string;
		micShortcut?: readonly string[];
		onVoiceMicKeyDown: (event: KeyboardEvent, voice: AgentComposerToolbarVoiceBinding) => void;
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
	<!--
		The mic button is swapped for the recording group and back, so its node is
		not something a test can hold on to. The phase lives on this wrapper, which
		stays put, and QA reads the state machine instead of guessing at it from a
		label that may already have been replaced.
	-->
	<div
		class="voice-controls flex shrink-0 items-end"
		data-voice-phase={currentVoiceState.phase}
		data-voice-error={currentVoiceState.errorMessage}
	>
		{#snippet recordingLeading()}
			<AgentInputVoiceRecordingLeading
				meterLevels={currentVoiceState.meterLevels}
				barCount={currentVoiceState.barCount}
				recordingElapsedTenths={currentVoiceState.recordingElapsedTenths}
			/>
		{/snippet}
		{#snippet micPrimary()}
			<AgentInputMicButton
				embeddedInGroup={recordingUi}
				visualState={getMicButtonVisualState(currentVoiceState.phase)}
				downloadPercent={currentVoiceState.downloadPercent}
				title={getMicButtonTitle(currentVoiceState)}
				ariaLabel={getMicButtonTitle(currentVoiceState)}
				shortcut={micShortcut}
				disabled={isMicButtonDisabled({ voiceState: currentVoiceState, composerIsDispatching })}
				onpointerdown={(event) => currentVoiceState.onMicPointerDown(event)}
				onpointerup={() => currentVoiceState.onMicPointerUp()}
				onpointercancel={() => currentVoiceState.onMicPointerCancel()}
				onkeydown={(event) => onVoiceMicKeyDown(event, currentVoiceState)}
			/>
		{/snippet}
		{#if recordingUi}
			<FusedPrimaryOverflowGroup leading={recordingLeading} primary={micPrimary} />
		{:else}
			{@render micPrimary()}
		{/if}
	</div>
{/if}
