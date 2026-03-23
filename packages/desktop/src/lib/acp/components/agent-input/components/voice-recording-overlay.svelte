<!--
  VoiceRecordingOverlay - Waveform overlay shown during recording/transcribing.
  Layered above the preserved (hidden) editor so cursor position survives.
  Respects prefers-reduced-motion: shows a pulsing dot instead of animated bars.
-->
<script lang="ts">
import * as m from "$lib/paraglide/messages.js";
import { canCancelVoiceInteraction, shouldShowVoiceOverlay } from "../logic/voice-ui-state.js";
import type { VoiceInputState } from "../state/voice-input-state.svelte.js";

function autoFocus(node: HTMLElement) {
	node.focus();
}

interface Props {
	voiceState: VoiceInputState;
}

const { voiceState }: Props = $props();

const isRecording = $derived(voiceState.phase === "recording");
const isTranscribing = $derived(voiceState.phase === "transcribing");
const isDownloading = $derived(voiceState.phase === "downloading_model");
const isError = $derived(voiceState.phase === "error");

const statusLabel = $derived.by(() => {
	if (isTranscribing) return m.voice_transcribing();
	if (isDownloading) return m.voice_downloading_model();
	if (isError) return voiceState.errorMessage || m.voice_start_recording();
	return m.voice_recording();
});

const canCancel = $derived(canCancelVoiceInteraction(voiceState.phase));
</script>

{#if shouldShowVoiceOverlay(voiceState.phase)}
	<div
		class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-md bg-background/95 backdrop-blur-sm"
	>
		<!-- Status label (aria-live for screen readers) -->
		<div aria-live="polite" class="sr-only">{statusLabel}</div>

		{#if isDownloading}
			<!-- Download progress -->
			<div class="flex w-full max-w-[200px] flex-col items-center gap-2">
				<span class="text-xs text-muted-foreground">{m.voice_downloading_model()}</span>
				<div class="h-1 w-full overflow-hidden rounded-full bg-border">
					<div
						class="h-full rounded-full bg-primary transition-all duration-300"
						style:width="{voiceState.downloadPercent}%"
					></div>
				</div>
				<span class="text-xs tabular-nums text-muted-foreground"
					>{Math.round(voiceState.downloadPercent)}%</span
				>
			</div>
		{:else if isTranscribing}
			<!-- Transcribing spinner -->
			<div class="flex flex-col items-center gap-2">
				<div
					class="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary"
					role="status"
					aria-label={m.voice_transcribing()}
				></div>
				<span class="text-xs text-muted-foreground">{m.voice_transcribing()}</span>
			</div>
		{:else if isError}
			<div class="flex max-w-[260px] flex-col items-center gap-2 text-center" role="alert" aria-live="assertive">
				<p class="text-sm font-medium text-foreground">
					{voiceState.errorMessage || m.voice_error_permission_denied()}
				</p>
				<button
					use:autoFocus
					class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
					onclick={() => voiceState.dismissError()}
				>
					{m.common_close()}
				</button>
			</div>
		{:else if isRecording}
			<!-- Waveform bars — reduced motion fallback: pulsing dot -->
			<div class="motion-reduce:hidden" aria-hidden="true">
				<div
					class="flex items-end gap-[2px]"
					role="img"
					aria-label={m.voice_waveform_label()}
				>
					{#each voiceState.waveform.barHeights as height, _i}
						<div
							class="w-[3px] rounded-sm bg-primary transition-none"
							style:height="{height}px"
						></div>
					{/each}
				</div>
			</div>
			<!-- Reduced motion fallback: pulsing dot -->
			<div class="hidden motion-reduce:flex items-center gap-2">
				<div class="h-3 w-3 animate-pulse rounded-full bg-destructive"></div>
				<span class="text-xs text-muted-foreground">{m.voice_recording()}</span>
			</div>

			<!-- Cancel button -->
			<button
				class="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
				onclick={() => voiceState.cancelRecording()}
			>
				{m.voice_cancel()}
			</button>
		{:else if canCancel}
			<button
				class="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
				onclick={() => voiceState.cancelRecording()}
			>
				{m.voice_cancel()}
			</button>
		{/if}
	</div>
{/if}
