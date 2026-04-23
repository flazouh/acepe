<!--
  AgentInputVoiceRecordingOverlay - Error/live waveform overlay in the composer content area.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/voice-recording-overlay.svelte.
  Accepts plain data (phase, meter levels, error message) as props.
-->
<script lang="ts">
	export type VoiceOverlayPhase = "idle" | "checking_permission" | "recording" | "error";

	interface Props {
		phase: VoiceOverlayPhase;
		meterLevels?: readonly number[];
		barCount?: number;
		errorMessage?: string | null;
		defaultErrorMessage?: string;
	}

	let {
		phase,
		meterLevels = [],
		barCount = 0,
		errorMessage = null,
		defaultErrorMessage = "Microphone access denied",
	}: Props = $props();

	const isError = $derived(phase === "error");
	const isLiveCapture = $derived(phase === "checking_permission" || phase === "recording");
</script>

<div class="voice-overlay flex min-h-7 items-center justify-center">
	{#if isLiveCapture}
		<div class="flex h-7 items-center justify-center motion-reduce:hidden" aria-hidden="true">
			<div class="voice-meter flex items-center gap-[1.5px]">
				{#each meterLevels as level, index (index)}
					{@const dist = Math.abs(index - Math.floor(barCount / 2))}
					{@const maxH = Math.max(8, 22 - dist * 1.5)}
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
		<div class="voice-error-card flex max-w-[280px] items-center justify-center text-center" role="alert" aria-live="assertive">
			<p class="text-[12px] leading-normal text-muted-foreground">
				{errorMessage ? errorMessage : defaultErrorMessage}
			</p>
		</div>
	{/if}
</div>

<style>
	.voice-overlay { animation: voice-fade-in 200ms ease-out; }
	.voice-error-card { animation: voice-error-appear 250ms ease-out; }
	.voice-meter { min-height: 22px; align-items: center; }
	.voice-bar { transition: height 90ms linear; }
	@keyframes voice-fade-in { from { opacity: 0; } to { opacity: 1; } }
	@keyframes voice-error-appear {
		from { opacity: 0; transform: translateY(4px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
