<!-- VoiceRecordingOverlay - Error-only content shown in the text area.
     Minimal Apple-like error display with subtle fade-in. -->
<script lang="ts">
import type { VoiceInputState } from "../state/voice-input-state.svelte.js";

interface Props {
	voiceState: VoiceInputState;
}

const { voiceState }: Props = $props();

const isError = $derived(voiceState.phase === "error");
const isLiveCapture = $derived(
	voiceState.phase === "checking_permission" || voiceState.phase === "recording"
);
</script>

<div class="voice-overlay flex flex-col items-center justify-center gap-3 min-h-[72px] py-4">
	{#if isLiveCapture}
		<div class="flex items-center justify-center h-8 motion-reduce:hidden" aria-hidden="true">
			<div class="voice-meter flex items-center gap-[1.5px]">
				{#each voiceState.waveform.meterLevels as level, index (index)}
					{@const dist = Math.abs(index - Math.floor(voiceState.waveform.barCount / 2))}
					{@const maxH = 30 - dist * 2.1}
					<div
						class="voice-bar rounded-full"
						style:width="2.5px"
						style:height="{1.25 + level * (maxH - 1.25)}px"
						style:background-color="#F9C396"
					></div>
				{/each}
			</div>
		</div>
	{:else if isError}
		<div
			class="voice-error-card flex max-w-[280px] flex-col items-center gap-1.5 text-center"
			role="alert"
			aria-live="assertive"
		>
			<p class="text-[13px] text-muted-foreground leading-snug">
				{voiceState.errorMessage ? voiceState.errorMessage : "Microphone permission denied"}
			</p>
		</div>
	{/if}
</div>

<style>
	.voice-overlay {
		animation: voice-fade-in 200ms ease-out;
	}

	.voice-error-card {
		animation: voice-error-appear 250ms ease-out;
	}

	.voice-meter {
		min-height: 30px;
		align-items: center;
	}

	.voice-bar {
		transition: height 90ms linear;
	}

	@keyframes voice-fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes voice-error-appear {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
