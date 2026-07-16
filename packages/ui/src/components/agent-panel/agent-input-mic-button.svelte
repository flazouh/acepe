<!--
  AgentInputMicButton - Mic toggle with recording/idle visual states.

  State machine stays in desktop; this component accepts the resolved visual state as a prop.

  Visual states:
  - idle: subtle mic icon, scales up on hover
  - busy: spinner (loading/transcribing)
  - download_progress: segmented progress bar
  - recording: red filled circle with stop square, pulsing glow
-->
<script lang="ts">
	import { LoadingIcon, HugeiconsIcon } from "../icons/index.js";
	import { SegmentedProgressBar } from "../segmented-progress-bar/index.js";
	import { buttonVariants } from "../button/variants.js";
	import { cn } from "../../lib/utils.js";

	export type AgentInputMicVisualState = "mic" | "spinner" | "stop" | "download_progress";

	interface Props {
		visualState?: AgentInputMicVisualState;
		downloadPercent?: number;
		disabled?: boolean;
		title?: string;
		ariaLabel?: string;
		embeddedInGroup?: boolean;
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
		embeddedInGroup = false,
		onpointerdown,
		onpointerup,
		onpointercancel,
		onkeydown,
	}: Props = $props();

	const isRecording = $derived(visualState === "stop");
	const STOP_RED = "#FF5D5A";
	const embeddedGroupShellClass = buttonVariants({ variant: "secondary", size: "icon-sm-narrow" });
	const buttonClass = $derived(
		cn(
			"group relative flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
			embeddedInGroup
				? cn(
						embeddedGroupShellClass,
						"rounded-none rounded-l-md shadow-none transition-colors duration-200 ease-out"
					)
				: "mic-btn rounded-full transition-all duration-200 ease-out",
			visualState === "mic" && "mic-idle",
			visualState === "stop" && "mic-recording",
			(visualState === "spinner" || visualState === "download_progress") && "mic-busy",
			visualState === "download_progress" && "mic-downloading",
			embeddedInGroup && visualState === "download_progress" && "mic-downloading-wide min-w-[88px] justify-end px-1.5",
			disabled && "opacity-40 cursor-not-allowed"
		)
	);
</script>

<button
	class={buttonClass}
	data-slot={embeddedInGroup ? "button" : undefined}
	aria-label={ariaLabel}
	aria-pressed={isRecording}
	{disabled}
	{title}
	{onpointerdown}
	{onpointerup}
	{onpointercancel}
	{onkeydown}
	tabindex="0"
>
	{#if visualState === "download_progress"}
		<SegmentedProgressBar
			ariaLabel={title}
			label=""
			percent={downloadPercent}
			segmentCount={20}
			showPercent={true}
			variant="downloadCompact"
		/>
	{:else if visualState === "spinner"}
		<LoadingIcon class="shrink-0 text-muted-foreground" size={16} aria-label={title} />
	{:else if visualState === "stop"}
		<div class="mic-stop-container flex items-center justify-center" class:embedded={embeddedInGroup}>
			<div class="mic-stop-circle" class:embedded={embeddedInGroup} style:background-color={STOP_RED}>
				<div class="mic-stop-square" class:embedded={embeddedInGroup}></div>
			</div>
		</div>
	{:else}
		<div class="mic-icon-wrap">
			<HugeiconsIcon name="microphone" class="mic-glyph" data-testid="agent-input-mic-icon" />
		</div>
	{/if}
</button>

<style>
	.mic-btn {
		width: 26px;
		height: 26px;
		color: var(--muted-foreground);
	}
	.mic-downloading,
	.mic-downloading-wide {
		width: auto;
		min-width: 74px;
		padding-inline: 6px;
		justify-content: flex-end;
	}
	.mic-idle { cursor: pointer; }
	.mic-idle:hover { color: var(--foreground); }
	.mic-idle :global(svg) { transition: color 150ms ease-out; }
	.mic-recording { cursor: pointer; }
	.mic-busy { cursor: default; }
	.mic-stop-container { width: 22px; height: 22px; }
	.mic-stop-container.embedded { width: 18px; height: 18px; }
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
	.mic-stop-circle.embedded {
		width: 16px;
		height: 16px;
		animation: none;
	}
	.mic-recording:hover .mic-stop-circle { transform: scale(1.08); }
	.mic-recording:hover .mic-stop-circle.embedded { transform: scale(1.04); }
	.mic-recording:active .mic-stop-circle { transform: scale(0.92); }
	.mic-stop-square {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background-color: white;
	}
	.mic-stop-square.embedded {
		width: 6px;
		height: 6px;
		border-radius: 1.5px;
	}
	.mic-icon-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.mic-glyph {
		width: 14px;
		height: 14px;
		display: block;
		color: currentColor;
	}
	@keyframes mic-glow-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(255, 93, 90, 0.0); }
		50% { box-shadow: 0 0 8px 3px rgba(255, 93, 90, 0.25); }
	}
</style>
