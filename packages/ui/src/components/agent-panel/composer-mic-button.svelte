<script lang="ts">
	import { Microphone } from "phosphor-svelte";

	export type MicButtonPhase = "idle" | "recording" | "transcribing" | "downloading" | "loading" | "checking" | "error";

	interface Props {
		phase?: MicButtonPhase;
		disabled?: boolean;
		downloadPercent?: number;
		title?: string;
		onpointerdown?: (event: PointerEvent) => void;
		onpointerup?: () => void;
		onpointercancel?: () => void;
		onkeydown?: (event: KeyboardEvent) => void;
	}

	let {
		phase = "idle",
		disabled = false,
		downloadPercent = 0,
		title = "",
		onpointerdown,
		onpointerup,
		onpointercancel,
		onkeydown,
	}: Props = $props();

	let isHovered = $state(false);

	const isRecording = $derived(phase === "recording" || phase === "checking");
	const isIdle = $derived(phase === "idle");
	const STOP_RED = "#FF5D5A";
</script>

<button
	class="mic-btn group relative flex items-center justify-center rounded-full
		transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-1
		focus-visible:ring-ring"
	class:mic-idle={isIdle}
	class:mic-recording={isRecording}
	class:mic-busy={!isIdle && !isRecording}
	class:opacity-40={disabled}
	class:cursor-not-allowed={disabled}
	aria-label={title}
	aria-pressed={isRecording}
	{disabled}
	onmouseenter={() => (isHovered = true)}
	onmouseleave={() => (isHovered = false)}
	{onpointerdown}
	{onpointerup}
	{onpointercancel}
	{onkeydown}
	tabindex="0"
>
	{#if isRecording}
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
	.mic-idle { cursor: pointer; }
	.mic-idle:hover { color: #f9c396; }
	.mic-recording { cursor: pointer; }
	.mic-busy { cursor: default; }
	.mic-stop-container { width: 22px; height: 22px; }
	.mic-stop-circle {
		width: 22px; height: 22px; border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		animation: mic-glow-pulse 2s ease-in-out infinite;
		transition: transform 150ms ease-out;
	}
	.mic-recording:hover .mic-stop-circle { transform: scale(1.08); }
	.mic-recording:active .mic-stop-circle { transform: scale(0.92); }
	.mic-stop-square { width: 8px; height: 8px; border-radius: 2px; background-color: white; }
	.mic-icon-wrap { display: flex; align-items: center; justify-content: center; }
	@keyframes mic-glow-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(255, 93, 90, 0.0); }
		50% { box-shadow: 0 0 8px 3px rgba(255, 93, 90, 0.25); }
	}
</style>
