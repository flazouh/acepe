<!--
  MicButton - Mic toggle in the agent input footer.
  Supports both click-to-toggle and press-and-hold patterns.
  Uses pointer capture so drag-off cancels the recording.
-->
<script lang="ts">
import Microphone from "phosphor-svelte/lib/Microphone";
import * as m from "$lib/paraglide/messages.js";
import { canCancelVoiceInteraction } from "../logic/voice-ui-state.js";
import type { VoiceInputState } from "../state/voice-input-state.svelte.js";

interface Props {
	voiceState: VoiceInputState;
	disabled?: boolean;
}

const { voiceState, disabled = false }: Props = $props();

function handlePointerDown(event: PointerEvent) {
	if (disabled) return;
	voiceState.onMicPointerDown(event);
}

function handlePointerUp() {
	if (disabled) return;
	voiceState.onMicPointerUp();
}

function handlePointerCancel() {
	voiceState.onMicPointerCancel();
}

function handleKeyDown(event: KeyboardEvent) {
	if (disabled) return;
	if (event.key === " " || event.key === "Enter") {
		event.preventDefault();
		if (voiceState.phase === "idle") {
			voiceState.onMicPointerDown(new PointerEvent("pointerdown"));
		} else if (voiceState.phase === "recording") {
			voiceState.stopRecording();
		}
	}
	if (event.key === "Escape" && canCancelVoiceInteraction(voiceState.phase)) {
		voiceState.cancelRecording();
	}
}

const isRecording = $derived(voiceState.phase === "recording");
const title = $derived(
	isRecording
		? m.voice_stop_recording()
		: m.voice_start_recording(),
);
</script>

<button
	class="flex h-7 w-7 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
	class:text-destructive={isRecording}
	class:animate-pulse={isRecording}
	class:text-muted-foreground={!isRecording && !disabled}
	class:opacity-40={disabled}
	class:cursor-not-allowed={disabled}
	class:hover:text-foreground={!disabled && !isRecording}
	{title}
	aria-label={title}
	aria-pressed={isRecording}
	{disabled}
	onpointerdown={handlePointerDown}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerCancel}
	onkeydown={handleKeyDown}
	tabindex="0"
>
	<Microphone class="h-3.5 w-3.5" weight={isRecording ? "fill" : "regular"} />
</button>
