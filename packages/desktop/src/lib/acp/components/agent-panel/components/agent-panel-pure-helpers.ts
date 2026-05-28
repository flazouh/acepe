/**
 * Pure presentational helpers extracted from agent-panel.svelte.
 * No reactive state or store access — inputs in, value out.
 */

import type { TokenRevealCss } from "@acepe/ui/agent-panel";
import type {
	RowTokenStream,
	SessionClockAnchor,
} from "../../../store/canonical-session-projection.js";
import type { ShipCardData } from "../../ship-card/ship-card-parser.js";
import {
	TOKEN_REVEAL_FADE_MS,
	TOKEN_REVEAL_STEP_MS,
	resolveTokenRevealBaselineMs,
	shouldKeepTokenRevealTiming,
} from "../../messages/token-reveal-motion.js";

export function buildTokenRevealCss(
	rowTokenStream: RowTokenStream | null,
	clockAnchor: SessionClockAnchor | null,
	streamingAnimationMode: "smooth" | "instant",
	reducedMotion: boolean,
	isStreaming: boolean
): TokenRevealCss | undefined {
	if (rowTokenStream === null || rowTokenStream.wordCount < 1 || clockAnchor === null) {
		return undefined;
	}

	const browserNowMs = globalThis.performance?.now();
	if (browserNowMs === undefined) {
		return undefined;
	}

	const baselineMs = resolveTokenRevealBaselineMs({
		latestDeltaProducedAtMonotonicMs: rowTokenStream.lastDeltaProducedAtMonotonicMs,
		clockAnchorRustMonotonicMs: clockAnchor.rustMonotonicMs,
		clockAnchorBrowserMs: clockAnchor.browserAnchorMs,
		browserNowMs,
	});
	const revealMode = reducedMotion ? "instant" : streamingAnimationMode;

	const tokenRevealCss = {
		revealCount: rowTokenStream.latestWordCount,
		revealedCharCount: rowTokenStream.accumulatedText.length,
		baselineMs,
		tokStepMs: TOKEN_REVEAL_STEP_MS,
		tokFadeDurMs: TOKEN_REVEAL_FADE_MS,
		mode: revealMode,
	};

	if (
		!shouldKeepTokenRevealTiming({
			isStreaming,
			timing: tokenRevealCss,
		})
	) {
		return undefined;
	}

	return tokenRevealCss;
}

export function hasStreamingPreviewContent(data: ShipCardData | null): boolean {
	return Boolean(data && (data.prTitle !== null || data.prDescription !== null));
}
