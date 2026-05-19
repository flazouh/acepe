import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

type AssistantSceneEntry = Extract<AgentPanelSceneEntryModel, { type: "assistant" }>;
type StreamingReproAssistantMessageChunks = NonNullable<AssistantSceneEntry["message"]>["chunks"];

export type StreamingReproAnswer = "streaming_visible" | "streaming_not_visible" | "unclear";

export type StreamingReproFollowState = "following" | "detached";
export type StreamingReproFallbackState = "healthy" | "fallback";

export interface StreamingReproPhase {
	readonly id: string;
	readonly label: string;
	readonly assistantText: string;
	readonly turnState: "Running" | "Completed";
	readonly activityKind: "awaiting_model" | "idle";
	readonly activeStreamingTailRowId: string | null;
	readonly assistantStreaming: boolean;
	readonly streamingAnimationMode?: "smooth" | "instant";
	readonly reducedMotion?: boolean;
	readonly assistantMessageChunks?: StreamingReproAssistantMessageChunks;
}

export interface StreamingReproPreset {
	readonly id: string;
	readonly name: string;
	readonly phases: readonly StreamingReproPhase[];
}

export function resolveStreamingReproActiveTailRowId(
	phase: StreamingReproPhase
): string | null {
	return phase.activeStreamingTailRowId;
}

export interface StreamingReproRecordedAnswer {
	readonly presetId: string;
	readonly phaseId: string;
	readonly phaseIndex: number;
	readonly answer: StreamingReproAnswer;
	readonly recordedAtMs: number;
	readonly hostWidthPx: number;
	readonly hostHeightPx: number;
	readonly theme: "light" | "dark";
	readonly followState: StreamingReproFollowState;
	readonly fallbackState: StreamingReproFallbackState;
	readonly speedMs: number;
}

export interface StreamingReproRunSummary {
	readonly presetId: string;
	readonly presetName: string;
	readonly phaseIndex: number;
	readonly phaseId: string;
	readonly speedMs: number;
	readonly host: {
		readonly width: number;
		readonly height: number;
	};
	readonly theme: "light" | "dark";
	readonly answers: readonly StreamingReproRecordedAnswer[];
}

interface StreamingReproControllerOptions {
	readonly now: () => number;
	readonly hostMetrics: {
		readonly width: number;
		readonly height: number;
	};
	readonly theme: "light" | "dark";
	readonly presets?: readonly StreamingReproPreset[];
	readonly defaultPresetId?: string;
}

const DEFAULT_SPEED_MS = 900;

const CORE_STREAMING_PRESET: StreamingReproPreset = {
	id: "core-streaming",
	name: "Agent panel streaming",
	phases: [
		{
			id: "thinking-only",
			label: "Agent is preparing",
			assistantText: "",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: null,
			assistantStreaming: false,
		},
		{
			id: "assistant-part-1",
			label: "First words arrive",
			assistantText: "Umbrellas are useful",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "assistant-part-2",
			label: "Next words arrive",
			assistantText: "Umbrellas are useful because they make bad weather easier to ignore.",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "assistant-part-3",
			label: "More words arrive",
			assistantText:
				"Umbrellas are useful because they make bad weather easier to ignore. A small canopy can turn a wet walk into something calm.",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "assistant-complete",
			label: "Answer completes",
			assistantText:
				"Umbrellas are useful because they make bad weather easier to ignore.\n\n- Compact list item one\n- Compact list item two\n\n```ts\nconst canopy = \"calm\";\nconsole.log(canopy);\n```\n\nA small canopy can turn a wet walk into something calm, especially when the rain starts before you are ready.",
			turnState: "Completed",
			activityKind: "idle",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: false,
		},
	],
};

const FIRST_WORD_REGRESSION_PRESET: StreamingReproPreset = {
	id: "first-word-regression",
	name: "First-word regression",
	phases: [
		{
			id: "first-word",
			label: "First word visible",
			assistantText: "The",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "same-id-full-rewrite",
			label: "Same assistant id has full canonical text",
			assistantText:
				"The answer should stay fully visible when the canonical assistant text replaces the first streamed word.",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "completed-full-text",
			label: "Completed full text",
			assistantText:
				"The answer should stay fully visible when the canonical assistant text replaces the first streamed word.",
			turnState: "Completed",
			activityKind: "idle",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: false,
		},
	],
};

const FINAL_STEP_FADE_PRESET: StreamingReproPreset = {
	id: "final-step-fade",
	name: "Final-step fade",
	phases: [
		{
			id: "visible-prefix",
			label: "Visible prefix",
			assistantText: "Raincoats keep",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "final-words",
			label: "Final words fade while advancement stops",
			assistantText: "Raincoats keep commuters dry during long gray walks.",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
	],
};

const COMPLETION_SNAP_FADE_PRESET: StreamingReproPreset = {
	id: "completion-snap-fade",
	name: "Completion snap fade",
	phases: [
		{
			id: "running-prefix",
			label: "Running prefix",
			assistantText: "The answer begins",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "completed-full-answer",
			label: "Completed full answer",
			assistantText:
				"The answer begins as a short prefix, then completes with enough fresh words to prove the final suffix can fade while the full text is already present.",
			turnState: "Completed",
			activityKind: "idle",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: false,
		},
	],
};

const RESTORED_COMPLETED_PRESET: StreamingReproPreset = {
	id: "restored-completed-history",
	name: "Restored completed history",
	phases: [
		{
			id: "completed-history",
			label: "Cold completed history",
			assistantText: "Completed history mounts as full stable text with no replayed reveal.",
			turnState: "Completed",
			activityKind: "idle",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: false,
		},
	],
};

const REDUCED_MOTION_PRESET: StreamingReproPreset = {
	id: "reduced-motion",
	name: "Reduced motion",
	phases: [
		{
			id: "reduced-motion-full-text",
			label: "Reduced motion full text",
			assistantText: "Reduced motion should render all assistant text without word fade.",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
			reducedMotion: true,
		},
	],
};

const INSTANT_MODE_PRESET: StreamingReproPreset = {
	id: "instant-mode",
	name: "Instant mode",
	phases: [
		{
			id: "instant-full-text",
			label: "Instant animation mode",
			assistantText: "Instant mode should render all assistant text without word fade.",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
			streamingAnimationMode: "instant",
		},
	],
};

const SAME_KEY_REWRITE_PRESET: StreamingReproPreset = {
	id: "same-key-rewrite",
	name: "Same-key rewrite",
	phases: [
		{
			id: "old-text",
			label: "Old same-key text",
			assistantText: "Umbrellas stay visible",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "replacement-text",
			label: "Replacement same-key text",
			assistantText: "Raincoats replace the answer without a blank blink.",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
	],
};

const TEXT_RESOURCE_TEXT_PRESET: StreamingReproPreset = {
	id: "text-resource-text",
	name: "Text/resource/text",
	phases: [
		{
			id: "ordered-text-resource-text",
			label: "Ordered text/resource/text",
			assistantText: "Text before resource. Text after resource remains in order.",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
			assistantMessageChunks: [
				{ type: "message", block: { type: "text", text: "Text before resource. " } },
				{
					type: "message",
					block: {
						type: "resource",
						resource: {
							uri: "file://debug-resource",
							text: "[debug resource]",
						},
					},
				},
				{
					type: "message",
					block: { type: "text", text: "Text after resource remains in order." },
				},
			],
		},
	],
};

export const DEFAULT_STREAMING_REPRO_PRESETS = [
	CORE_STREAMING_PRESET,
	FIRST_WORD_REGRESSION_PRESET,
	FINAL_STEP_FADE_PRESET,
	COMPLETION_SNAP_FADE_PRESET,
	RESTORED_COMPLETED_PRESET,
	REDUCED_MOTION_PRESET,
	INSTANT_MODE_PRESET,
	SAME_KEY_REWRITE_PRESET,
	TEXT_RESOURCE_TEXT_PRESET,
] as const;

export class StreamingReproController {
	readonly presets: readonly StreamingReproPreset[];
	activePreset: StreamingReproPreset;
	readonly hostMetrics: { readonly width: number; readonly height: number };
	readonly theme: "light" | "dark";
	phaseIndex = 0;
	speedMs = DEFAULT_SPEED_MS;
	answers: StreamingReproRecordedAnswer[] = [];
	isAutoplaying = false;
	private autoplayTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly options: StreamingReproControllerOptions) {
		this.presets = options.presets ?? DEFAULT_STREAMING_REPRO_PRESETS;
		this.activePreset =
			this.presets.find((preset) => preset.id === options.defaultPresetId) ?? this.presets[0]!;
		this.hostMetrics = {
			width: options.hostMetrics.width,
			height: options.hostMetrics.height,
		};
		this.theme = options.theme;
	}

	get activePhase(): StreamingReproPhase {
		return this.activePreset.phases[this.phaseIndex]!;
	}

	setActivePreset(presetId: string): void {
		const nextPreset = this.presets.find((preset) => preset.id === presetId);
		if (nextPreset === undefined || nextPreset.id === this.activePreset.id) {
			return;
		}

		this.stop();
		this.activePreset = nextPreset;
		this.phaseIndex = 0;
		this.answers = [];
	}

	nextPhase(): void {
		if (this.phaseIndex >= this.activePreset.phases.length - 1) {
			this.stop();
			return;
		}

		this.phaseIndex += 1;
		if (this.phaseIndex >= this.activePreset.phases.length - 1) {
			this.stop();
		}
	}

	previousPhase(): void {
		if (this.phaseIndex === 0) {
			return;
		}
		this.phaseIndex -= 1;
	}

	setSpeedMs(speedMs: number): void {
		this.speedMs = speedMs;
		if (this.isAutoplaying) {
			this.stop();
			this.play();
		}
	}

	play(): void {
		if (this.isAutoplaying) {
			return;
		}
		this.isAutoplaying = true;
		this.scheduleNextTick();
	}

	stop(): void {
		this.isAutoplaying = false;
		if (this.autoplayTimer !== null) {
			clearTimeout(this.autoplayTimer);
			this.autoplayTimer = null;
		}
	}

	reset(): void {
		this.stop();
		this.phaseIndex = 0;
		this.answers = [];
	}

	recordAnswer(
		answer: StreamingReproAnswer,
		context: {
			readonly followState: StreamingReproFollowState;
			readonly fallbackState: StreamingReproFallbackState;
		}
	): void {
		this.answers = this.answers.concat({
			presetId: this.activePreset.id,
			phaseId: this.activePhase.id,
			phaseIndex: this.phaseIndex,
			answer,
			recordedAtMs: this.options.now(),
			hostWidthPx: this.hostMetrics.width,
			hostHeightPx: this.hostMetrics.height,
			theme: this.theme,
			followState: context.followState,
			fallbackState: context.fallbackState,
			speedMs: this.speedMs,
		});
	}

	exportRunSummary(): StreamingReproRunSummary {
		return {
			presetId: this.activePreset.id,
			presetName: this.activePreset.name,
			phaseIndex: this.phaseIndex,
			phaseId: this.activePhase.id,
			speedMs: this.speedMs,
			host: {
				width: this.hostMetrics.width,
				height: this.hostMetrics.height,
			},
			theme: this.theme,
			answers: this.answers,
		};
	}

	private scheduleNextTick(): void {
		if (!this.isAutoplaying) {
			return;
		}

		this.autoplayTimer = setTimeout(() => {
			this.autoplayTimer = null;
			this.nextPhase();
			if (this.isAutoplaying) {
				this.scheduleNextTick();
			}
		}, this.speedMs);
	}
}

export function createStreamingReproController(
	options: StreamingReproControllerOptions
): StreamingReproController {
	return new StreamingReproController(options);
}
