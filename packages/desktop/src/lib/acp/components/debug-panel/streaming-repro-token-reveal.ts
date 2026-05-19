import type { AgentPanelSceneEntryModel, TokenRevealCss } from "@acepe/ui/agent-panel";
import { countWordsInMarkdown } from "@acepe/ui/markdown";

import {
	shouldKeepTokenRevealTiming,
	TOKEN_REVEAL_FADE_MS,
	TOKEN_REVEAL_STEP_MS,
} from "../messages/token-reveal-motion.js";
import {
	resolveStreamingReproActiveTailRowId,
	type StreamingReproPhase,
	type StreamingReproPreset,
} from "./streaming-repro-controller";

function resolveTokenRevealMode(phase: StreamingReproPhase): "smooth" | "instant" {
	if (phase.reducedMotion === true || phase.streamingAnimationMode === "instant") {
		return "instant";
	}

	return "smooth";
}

function resolvePreviousPhaseWordCount(
	preset: StreamingReproPreset,
	phaseIndex: number,
	phase: StreamingReproPhase
): number {
	if (phase.activeStreamingTailRowId === null) {
		return 0;
	}

	for (let index = phaseIndex - 1; index >= 0; index -= 1) {
		const previousPhase = preset.phases[index];
		if (previousPhase?.activeStreamingTailRowId !== phase.activeStreamingTailRowId) {
			continue;
		}

		return countWordsInMarkdown(previousPhase.assistantText);
	}

	return 0;
}

export function buildStreamingReproTokenRevealCss(input: {
	readonly preset: StreamingReproPreset;
	readonly phaseIndex: number;
	readonly phase: StreamingReproPhase;
	readonly phaseElapsedMs: number;
}): TokenRevealCss | undefined {
	if (resolveStreamingReproActiveTailRowId(input.phase) === null) {
		return undefined;
	}

	const previousWordCount = resolvePreviousPhaseWordCount(
		input.preset,
		input.phaseIndex,
		input.phase
	);
	const currentWordCount = countWordsInMarkdown(input.phase.assistantText);
	const revealCount =
		currentWordCount > previousWordCount ? currentWordCount - previousWordCount : currentWordCount;
	if (revealCount < 1) {
		return undefined;
	}

	const baselineMs = -(previousWordCount * TOKEN_REVEAL_STEP_MS + input.phaseElapsedMs);
	const revealMode = resolveTokenRevealMode(input.phase);
	const tokenRevealCss = {
		revealCount,
		revealedCharCount: input.phase.assistantText.length,
		baselineMs,
		tokStepMs: TOKEN_REVEAL_STEP_MS,
		tokFadeDurMs: TOKEN_REVEAL_FADE_MS,
		mode: revealMode,
	};

	if (
		!shouldKeepTokenRevealTiming({
			isStreaming: input.phase.assistantStreaming === true,
			timing: tokenRevealCss,
		})
	) {
		return undefined;
	}

	return tokenRevealCss;
}

export function applyStreamingReproTokenReveal(input: {
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly preset: StreamingReproPreset;
	readonly phaseIndex: number;
	readonly phase: StreamingReproPhase;
	readonly phaseElapsedMs: number;
}): readonly AgentPanelSceneEntryModel[] {
	const tokenRevealCss = buildStreamingReproTokenRevealCss({
		preset: input.preset,
		phaseIndex: input.phaseIndex,
		phase: input.phase,
		phaseElapsedMs: input.phaseElapsedMs,
	});

	const activeStreamingTailRowId = resolveStreamingReproActiveTailRowId(input.phase);
	if (tokenRevealCss === undefined || activeStreamingTailRowId === null) {
		return input.entries;
	}

	return input.entries.map((entry) => {
		if (entry.type !== "assistant" || entry.id !== activeStreamingTailRowId) {
			return entry;
		}

		return {
			id: entry.id,
			type: "assistant",
			markdown: entry.markdown,
			message: entry.message,
			isStreaming: entry.isStreaming,
			tokenRevealCss,
			timestampMs: entry.timestampMs,
		};
	});
}
