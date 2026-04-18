<!--
  MicButton - Mic toggle in the agent input footer.
  Apple-like design: smooth morphing between states, red glow on recording.
  Supports both click-to-toggle and press-and-hold patterns.
  Uses pointer capture so drag-off cancels the recording.

  States:
  - idle: subtle mic icon, scales up on hover
  - downloading_model: circular progress ring
	- loading_model / transcribing: Spinner (LoadingIcon)
	- checking_permission / recording: red filled circle with rounded stop square, soft pulsing glow
-->
<script lang="ts">
	import { VoiceDownloadProgress } from "@acepe/ui";
	import { Microphone } from "phosphor-svelte";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { canCancelVoiceInteraction } from "../logic/voice-ui-state.js";
import { getMicButtonVisualState } from "./mic-button-state.js";
import type { VoiceInputState } from "../state/voice-input-state.svelte.js";

interface Props {
	voiceState: VoiceInputState;
	disabled?: boolean;
}

const { voiceState, disabled = false }: Props = $props();

let isHovered = $state(false);

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
			voiceState.onKeyboardHoldStart();
		} else if (voiceState.phase === "recording") {
			voiceState.onKeyboardHoldEnd();
		}
	}
	if (event.key === "Escape" && canCancelVoiceInteraction(voiceState.phase)) {
		voiceState.cancelRecording();
	}
}

const isRecording = $derived(voiceState.phase === "recording");
const isTranscribing = $derived(voiceState.phase === "transcribing");
const isDownloading = $derived(voiceState.phase === "downloading_model");
const isLoadingModel = $derived(voiceState.phase === "loading_model");
const isCheckingPermission = $derived(voiceState.phase === "checking_permission");
const visualState = $derived(getMicButtonVisualState(voiceState.phase));

const title = $derived(
	isDownloading
		? "Downloading speech model…"
		: isLoadingModel
			? "Loading model…"
			: isCheckingPermission
				? "Checking…"
				: isTranscribing
					? "Transcribing…"
					: isRecording
						? "Stop recording"
						: "Start voice recording"
);

const hoverTitle = $derived(visualState === "mic" ? "Hold Right ⌥ to talk" : title);

/** Red color from design system */
const STOP_RED = "#FF5D5A";
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props: triggerProps })}
			<button
				{...triggerProps}
				class="mic-btn group relative flex items-center justify-center rounded-full
					transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-1
					focus-visible:ring-ring"
				class:mic-idle={visualState === "mic"}
				class:mic-recording={visualState === "stop"}
				class:mic-busy={visualState === "spinner" || visualState === "download_progress"}
				class:mic-downloading={visualState === "download_progress"}
				class:opacity-40={disabled}
				class:cursor-not-allowed={disabled}
				aria-label={title}
				aria-pressed={isRecording}
				disabled={disabled}
				onmouseenter={() => (isHovered = true)}
				onmouseleave={() => (isHovered = false)}
				onpointerdown={handlePointerDown}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerCancel}
				onkeydown={handleKeyDown}
				tabindex="0"
			>
				{#if visualState === "download_progress"}
					<VoiceDownloadProgress
						ariaLabel={title}
						compact={true}
						label=""
						percent={voiceState.downloadPercent}
						segmentCount={20}
						showPercent={false}
					/>
				{:else if visualState === "spinner"}
					<!-- Loading spinner (uses shared LoadingIcon) -->
					<Spinner class="h-4 w-4" />
				{:else if visualState === "stop"}
					<!-- Red filled circle with stop square -->
					<div class="mic-stop-container flex items-center justify-center">
						<div class="mic-stop-circle" style:background-color={STOP_RED}>
							<div class="mic-stop-square"></div>
						</div>
					</div>
				{:else}
					<!-- Idle mic icon with hover scale -->
					<div class="mic-icon-wrap">
						<Microphone
							class="h-[15px] w-[15px] transition-all duration-150 ease-out"
							weight={isHovered ? "fill" : "regular"}
						/>
					</div>
				{/if}
			</button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>
		<div class="flex items-center gap-1.5">
			{#if visualState === "mic"}
				<span>Hold</span>
				<KbdGroup><Kbd>Right ⌥</Kbd></KbdGroup>
			{:else}
				<span>{hoverTitle}</span>
			{/if}
		</div>
	</Tooltip.Content>
</Tooltip.Root>

<style>
	.mic-btn {
		width: 26px;
		height: 26px;
		color: var(--muted-foreground);
	}

	.mic-downloading {
		width: auto;
		min-width: 74px;
		padding-inline: 6px;
		justify-content: flex-end;
	}

	/* Idle state: subtle hover lift */
	.mic-idle {
		cursor: pointer;
	}
	.mic-idle:hover {
		color: #f9c396;
	}

	.mic-idle :global(svg) {
		transition: fill 150ms ease-out;
	}

	.mic-idle:hover :global(svg) {
		fill: currentColor;
	}

	/* Recording state: red glow pulse */
	.mic-recording {
		cursor: pointer;
	}

	/* Busy states (spinner/download) */
	.mic-busy {
		cursor: default;
	}

	/* Stop button: red filled circle with white stop square */
	.mic-stop-container {
		width: 22px;
		height: 22px;
	}

	.mic-stop-circle {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: mic-glow-pulse 2s ease-in-out infinite;
		transition: transform 150ms ease-out;
	}

	.mic-recording:hover .mic-stop-circle {
		transform: scale(1.08);
	}
	.mic-recording:active .mic-stop-circle {
		transform: scale(0.92);
	}

	.mic-stop-square {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background-color: white;
	}

	/* Mic icon wrapper */
	.mic-icon-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Soft pulsing glow for recording */
	@keyframes mic-glow-pulse {
		0%, 100% {
			box-shadow: 0 0 0 0 rgba(255, 93, 90, 0.0);
		}
		50% {
			box-shadow: 0 0 8px 3px rgba(255, 93, 90, 0.25);
		}
	}
</style>
