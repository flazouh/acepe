<!--
  AgentInputVoiceRecordingOverlay - Error message overlay in the composer content area.

  Live waveform bars render in the fused toolbar leading segment during recording.
-->
<script lang="ts">
	export type VoiceOverlayPhase = "idle" | "checking_permission" | "recording" | "error";

	interface Props {
		phase: VoiceOverlayPhase;
		errorMessage?: string | null;
		defaultErrorMessage?: string;
	}

	let {
		phase,
		errorMessage = null,
		defaultErrorMessage = "Microphone access denied",
	}: Props = $props();

	const isError = $derived(phase === "error");
</script>

<div class="voice-overlay flex min-h-7 items-center justify-center">
	{#if isError}
		<div
			class="voice-error-card flex max-w-[280px] items-center justify-center text-center"
			role="alert"
			aria-live="assertive"
		>
			<p class="text-[12px] leading-normal text-muted-foreground">
				{errorMessage ? errorMessage : defaultErrorMessage}
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
	@keyframes voice-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
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
