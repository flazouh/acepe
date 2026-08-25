<!--
  AgentInputMicButton - Mic toggle with recording/idle visual states.

  State machine stays in desktop; this component accepts the resolved visual state as a prop.

  Always wears the secondary chip shell; `embeddedInGroup` only squares off the
  left corners so it can fuse with the recording timer.

  Visual states:
  - idle: subtle mic icon
  - busy: spinner (loading/transcribing)
  - download_progress: segmented progress bar
  - recording: red filled circle with stop square, pulsing glow
-->
<script lang="ts">
	import { getMicButtonAccessibleDescription } from "./agent-input-mic-button-state.js";
	import { LoadingIcon, HugeiconsIcon } from "../icons/index.js";
	import { SegmentedProgressBar } from "../segmented-progress-bar/index.js";
	import { buttonVariants } from "../button/variants.js";
	import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";
	import { cn } from "../../lib/utils.js";

	export type AgentInputMicVisualState = "mic" | "spinner" | "stop" | "download_progress";

	interface Props {
		visualState?: AgentInputMicVisualState;
		downloadPercent?: number;
		disabled?: boolean;
		title?: string;
		ariaLabel?: string;
		shortcut?: readonly string[];
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
		shortcut = [],
		embeddedInGroup = false,
		onpointerdown,
		onpointerup,
		onpointercancel,
		onkeydown,
	}: Props = $props();

	const isRecording = $derived(visualState === "stop");
	const tooltipDescription = $derived(getMicButtonAccessibleDescription(title, shortcut));
	const STOP_RED = "#FF5D5A";
	const MIC_GLYPH_SIZE_PX = 14;
	const chipShellClass = buttonVariants({ variant: "secondary", size: "icon-sm-narrow" });
	const buttonClass = $derived(
		cn(
			chipShellClass,
			"group relative shadow-none transition-colors duration-200 ease-out focus-visible:ring-1 focus-visible:ring-ring",
			embeddedInGroup ? "rounded-none rounded-r-md" : "w-7 rounded-md",
			visualState === "mic" && "mic-idle",
			visualState === "stop" && "mic-recording",
			(visualState === "spinner" || visualState === "download_progress") && "mic-busy",
			visualState === "download_progress" && "mic-downloading min-w-[88px] justify-end px-1.5",
			disabled && "opacity-40 cursor-not-allowed"
		)
	);
</script>

{#snippet micGlyph()}
	<span class="sr-only">{tooltipDescription}</span>
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
		<HugeiconsIcon
			name="microphone"
			size={MIC_GLYPH_SIZE_PX}
			class="shrink-0"
			data-testid="agent-input-mic-icon"
		/>
	{/if}
{/snippet}

<Tooltip>
	<TooltipTrigger>
		{#snippet child({ props: triggerProps })}
			{#if disabled}
				<span {...triggerProps} class="inline-flex">
					<button
						class={buttonClass}
						data-slot={embeddedInGroup ? "button" : undefined}
						data-testid="agent-input-mic"
						type="button"
						aria-label={ariaLabel}
						aria-pressed={isRecording}
						disabled={true}
						{onpointerdown}
						{onpointerup}
						{onpointercancel}
						{onkeydown}
						tabindex="0"
					>
						{@render micGlyph()}
					</button>
				</span>
			{:else}
				<button
					{...triggerProps}
					class={buttonClass}
					data-slot={embeddedInGroup ? "button" : undefined}
					data-testid="agent-input-mic"
					type="button"
					aria-label={ariaLabel}
					aria-pressed={isRecording}
					{onpointerdown}
					{onpointerup}
					{onpointercancel}
					{onkeydown}
					tabindex="0"
				>
					{@render micGlyph()}
				</button>
			{/if}
		{/snippet}
	</TooltipTrigger>
	<TooltipContent side="top">
		<span class="font-medium">{title}</span>
	</TooltipContent>
</Tooltip>

<style>
	.mic-downloading {
		width: auto;
	}
	.mic-idle {
		cursor: pointer;
		color: var(--muted-foreground);
	}
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
	@keyframes mic-glow-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(255, 93, 90, 0.0); }
		50% { box-shadow: 0 0 8px 3px rgba(255, 93, 90, 0.25); }
	}
</style>
