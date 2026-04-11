<!--
  AgentInputMicButton - Mic toggle with recording/idle visual states.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/mic-button.svelte.
  State machine stays in desktop; this component accepts the resolved visual state as a prop.

  Visual states:
  - idle: subtle mic icon, scales up on hover
  - busy: spinner (loading/transcribing)
  - download_progress: segmented progress bar
  - recording: red filled circle with stop square, pulsing glow
-->
<script lang="ts">
	import { Microphone } from "phosphor-svelte";

	export type AgentInputMicVisualState = "mic" | "spinner" | "stop" | "download_progress";

	interface Props {
		visualState?: AgentInputMicVisualState;
		downloadPercent?: number;
		disabled?: boolean;
		title?: string;
		ariaLabel?: string;
		onpointerdown?: (event: PointerEvent) => void;
		onpointerup?: () => void;
		onpointercancel?: () => void;
		onkeydown?: (event: KeyboardEvent) => void;
	}

	let {
		visualState = "mic",
		downloadPercent = 0,
		disabled = false,
		title = "Record",
		ariaLabel = "Record",
		onpointerdown,
		onpointerup,
		onpointercancel,
		onkeydown,
	}: Props = $props();

	let isHovered = $state(false);
	const isRecording = $derived(visualState === "stop");
	const STOP_RED = "#FF5D5A";
</script>

<button
	class="mic-btn group relative flex items-center justify-center rounded-full
		transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-1
		focus-visible:ring-ring"
	class:mic-idle={visualState === "mic"}
	class:mic-recording={visualState === "stop"}
	class:mic-busy={visualState === "spinner" || visualState === "download_progress"}
	class:mic-downloading={visualState === "download_progress"}
	class:opacity-40={disabled}
	class:cursor-not-allowed={disabled}
	aria-label={ariaLabel}
	aria-pressed={isRecording}
	{disabled}
	{title}
	onmouseenter={() => (isHovered = true)}
	onmouseleave={() => (isHovered = false)}
	{onpointerdown}
	{onpointerup}
	{onpointercancel}
	{onkeydown}
	tabindex="0"
>
	{#if visualState === "download_progress"}
		<div class="flex items-center gap-[2px]" aria-label={title}>
			{#each Array(20) as _, i (i)}
				<div
					class="rounded-full transition-all duration-150 {downloadPercent >= (i + 1) * 5
						? 'h-[9px] w-[3px] bg-foreground'
						: 'h-[6px] w-[3px] bg-foreground/25'}"
				></div>
			{/each}
		</div>
	{:else if visualState === "spinner"}
		<div class="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"></div>
	{:else if visualState === "stop"}
		<div class="mic-stop-container flex items-center justify-center">
			<div class="mic-stop-circle" style:background-color={STOP_RED}>
				<div class="mic-stop-square"></div>
			</div>
		</div>
	{:else}
		<div class="mic-icon-wrap">
			<Microphone
				class="h-[15px] w-[15px] transition-all duration-150 ease-out"
				weight={isHovered ? "fill" : "regular"}
			/>
		</div>
	{/if}
</button>

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
	.mic-idle { cursor: pointer; }
	.mic-idle:hover { color: #f9c396; }
	.mic-idle :global(svg) { transition: fill 150ms ease-out; }
	.mic-idle:hover :global(svg) { fill: currentColor; }
	.mic-recording { cursor: pointer; }
	.mic-busy { cursor: default; }
	.mic-stop-container { width: 22px; height: 22px; }
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
	.mic-recording:hover .mic-stop-circle { transform: scale(1.08); }
	.mic-recording:active .mic-stop-circle { transform: scale(0.92); }
	.mic-stop-square {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background-color: white;
	}
	.mic-icon-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	@keyframes mic-glow-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(255, 93, 90, 0.0); }
		50% { box-shadow: 0 0 8px 3px rgba(255, 93, 90, 0.25); }
	}
</style>
