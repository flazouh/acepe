<!--
  MicButton - Mic toggle in the agent input footer.
  Supports both click-to-toggle and press-and-hold patterns.
  Uses pointer capture so drag-off cancels the recording.

  States:
  - idle: gold mic icon
  - downloading_model: circular progress ring (icon only, no label)
  - loading_model: spinning circle (icon only, no label)
  - checking_permission: spinning circle (icon only, no label)
  - recording: red filled stop icon
-->
<script lang="ts">
import Microphone from "phosphor-svelte/lib/Microphone";
import StopCircle from "phosphor-svelte/lib/StopCircle";
import * as m from "$lib/paraglide/messages.js";
import { canCancelVoiceInteraction } from "../logic/voice-ui-state.js";
import type { VoiceInputState } from "../state/voice-input-state.svelte.js";

interface Props {
	voiceState: VoiceInputState;
	disabled?: boolean;
}

const { voiceState, disabled = false }: Props = $props();

function handlePointerDown(event: PointerEvent) {
	if (disabled || voiceState.isBusy) return;
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
const isDownloading = $derived(voiceState.phase === "downloading_model");
const isLoadingModel = $derived(voiceState.phase === "loading_model");
const isCheckingPermission = $derived(voiceState.phase === "checking_permission");
const isBusy = $derived(voiceState.isBusy);

const title = $derived(
	isDownloading
		? m.voice_downloading_model()
		: isLoadingModel
			? "Loading model…"
			: isCheckingPermission
				? "Checking…"
				: isRecording
					? m.voice_stop_recording()
					: m.voice_start_recording(),
);

/** SVG circle constants for the 14px progress ring */
const RING_SIZE = 14;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const dashOffset = $derived(
	RING_CIRCUMFERENCE - (voiceState.downloadPercent / 100) * RING_CIRCUMFERENCE,
);
</script>

<button
	class="group flex items-center justify-center h-7 w-7 text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
	class:text-destructive={isRecording}
	class:opacity-40={disabled}
	class:cursor-not-allowed={disabled || isBusy}
	class:hover:text-foreground={!disabled && !isRecording && !isBusy}
	{title}
	aria-label={title}
	aria-pressed={isRecording}
	disabled={disabled}
	onpointerdown={handlePointerDown}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerCancel}
	onkeydown={handleKeyDown}
	tabindex="0"
>
	{#if isDownloading}
		<!-- Circular progress ring that fills as download progresses -->
		<svg
			width={RING_SIZE}
			height={RING_SIZE}
			viewBox="0 0 {RING_SIZE} {RING_SIZE}"
			class="shrink-0 -rotate-90"
			role="progressbar"
			aria-valuenow={Math.round(voiceState.downloadPercent)}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<!-- Background track -->
			<circle
				cx={RING_SIZE / 2}
				cy={RING_SIZE / 2}
				r={RING_RADIUS}
				fill="none"
				stroke="currentColor"
				stroke-width={RING_STROKE}
				class="opacity-20"
			/>
			<!-- Filled arc -->
			<circle
				cx={RING_SIZE / 2}
				cy={RING_SIZE / 2}
				r={RING_RADIUS}
				fill="none"
				stroke="currentColor"
				stroke-width={RING_STROKE}
				stroke-linecap="round"
				stroke-dasharray={RING_CIRCUMFERENCE}
				stroke-dashoffset={dashOffset}
				class="text-primary transition-[stroke-dashoffset] duration-300"
			/>
		</svg>
	{:else if isLoadingModel || isCheckingPermission}
		<!-- Indeterminate spinning circle -->
		<svg
			width={RING_SIZE}
			height={RING_SIZE}
			viewBox="0 0 {RING_SIZE} {RING_SIZE}"
			class="shrink-0 animate-spin"
			role="status"
			aria-label="Loading model…"
		>
			<circle
				cx={RING_SIZE / 2}
				cy={RING_SIZE / 2}
				r={RING_RADIUS}
				fill="none"
				stroke="currentColor"
				stroke-width={RING_STROKE}
				class="opacity-20"
			/>
			<circle
				cx={RING_SIZE / 2}
				cy={RING_SIZE / 2}
				r={RING_RADIUS}
				fill="none"
				stroke="currentColor"
				stroke-width={RING_STROKE}
				stroke-linecap="round"
				stroke-dasharray={RING_CIRCUMFERENCE}
				stroke-dashoffset={RING_CIRCUMFERENCE * 0.75}
				class="text-primary"
			/>
		</svg>
	{:else if isRecording}
		<StopCircle class="h-3.5 w-3.5" weight="fill" />
	{:else}
		<Microphone class="h-3.5 w-3.5 hidden group-hover:block" weight="fill" />
		<Microphone class="h-3.5 w-3.5 block group-hover:hidden" weight="regular" />
	{/if}
</button>
