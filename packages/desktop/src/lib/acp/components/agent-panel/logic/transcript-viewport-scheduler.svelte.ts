import type {
	TranscriptRendererAdapter,
	TranscriptRendererEffectOutcome,
} from "./transcript-renderer-adapter.js";
import type { TranscriptViewportEffect } from "./transcript-viewport-effects.js";
import type { TranscriptViewportEvent } from "./transcript-viewport-events.js";

export type TranscriptViewportSchedulerOptions = {
	adapter: TranscriptRendererAdapter;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (id: number) => void;
	getGeneration(): number;
	getSessionId(): string | null;
	dispatchEvent?: (event: TranscriptViewportEvent) => void;
};

export type TranscriptViewportScheduler = {
	schedule(effects: readonly TranscriptViewportEffect[]): void;
	cancel(): void;
};

function isReadEffect(effect: TranscriptViewportEffect): boolean {
	return (
		effect.type === "MeasureViewport" ||
		effect.type === "PreserveAnchor" ||
		effect.type === "ProbeRendererHealth"
	);
}

function isScrollWriteEffect(effect: TranscriptViewportEffect): boolean {
	return (
		effect.type === "RevealRow" ||
		effect.type === "RevealTail" ||
		effect.type === "ApplyScrollOffset"
	);
}

function haveSameViewportRevision(
	left: TranscriptViewportEffect,
	right: TranscriptViewportEffect
): boolean {
	return left.sessionId === right.sessionId && left.generation === right.generation;
}

function removePendingEffects(
	pendingEffects: TranscriptViewportEffect[],
	shouldRemove: (effect: TranscriptViewportEffect) => boolean
): void {
	for (let index = pendingEffects.length - 1; index >= 0; index -= 1) {
		const effect = pendingEffects[index];
		if (effect !== undefined && shouldRemove(effect)) {
			pendingEffects.splice(index, 1);
		}
	}
}

function appendPendingEffect(
	pendingEffects: TranscriptViewportEffect[],
	effect: TranscriptViewportEffect
): void {
	if (isScrollWriteEffect(effect)) {
		removePendingEffects(pendingEffects, (pendingEffect) => {
			return isScrollWriteEffect(pendingEffect) && haveSameViewportRevision(pendingEffect, effect);
		});
		pendingEffects.push(effect);
		return;
	}

	if (effect.type === "PreserveAnchor") {
		removePendingEffects(pendingEffects, (pendingEffect) => {
			return pendingEffect.type === "PreserveAnchor" && haveSameViewportRevision(pendingEffect, effect);
		});
		pendingEffects.push(effect);
		return;
	}

	if (effect.type === "MeasureViewport" || effect.type === "ProbeRendererHealth") {
		removePendingEffects(pendingEffects, (pendingEffect) => {
			return pendingEffect.type === effect.type && haveSameViewportRevision(pendingEffect, effect);
		});
		pendingEffects.push(effect);
		return;
	}

	pendingEffects.push(effect);
}

function isEffectCurrent(
	effect: TranscriptViewportEffect,
	getSessionId: () => string | null,
	getGeneration: () => number
): boolean {
	return effect.sessionId === getSessionId() && effect.generation === getGeneration();
}

function skippedOutcome(
	effect: TranscriptViewportEffect,
	reason: "stale-generation" | "missing-adapter" | "missing-target"
): TranscriptRendererEffectOutcome {
	return {
		type: "skipped",
		effectType: effect.type,
		reason,
	};
}

function executeReadEffect(
	adapter: TranscriptRendererAdapter,
	effect: TranscriptViewportEffect,
	dispatchEvent: ((event: TranscriptViewportEvent) => void) | undefined
): void {
	if (effect.type === "MeasureViewport") {
		const outcome = adapter.measureViewport();
		if (outcome.type === "measured") {
			dispatchEvent?.({
				type: "ScrollMeasured",
				sessionId: effect.sessionId,
				generation: effect.generation,
				measurement: outcome.measurement,
			});
		}
		return;
	}
	if (effect.type === "PreserveAnchor") {
		const outcome = adapter.measureAnchor(effect.anchorKey);
		if (outcome.type === "missing") {
			dispatchEvent?.({
				type: "AdapterAnchorMissing",
				sessionId: effect.sessionId,
				generation: effect.generation,
				anchorKey: effect.anchorKey,
				fallbackOffsetPx: 0,
			});
			return;
		}
		const measurementOutcome = adapter.measureViewport();
		if (measurementOutcome.type === "missing") {
			adapter.reportEffectOutcome(skippedOutcome(effect, measurementOutcome.reason));
			return;
		}
		const correctionPx = outcome.offsetPx - effect.offsetPx;
		if (Math.abs(correctionPx) > 0.5) {
			adapter.reportEffectOutcome(
				adapter.applyScrollOffset({
					type: "ApplyScrollOffset",
					sessionId: effect.sessionId,
					generation: effect.generation,
					offsetPx: measurementOutcome.measurement.scrollOffset + correctionPx,
					reason: "preserve-anchor",
				})
			);
		}
		return;
	}
	if (effect.type === "ProbeRendererHealth") {
		const outcome = adapter.probeRendererHealth();
		dispatchEvent?.({
			type: "RendererHealthProbeReported",
			sessionId: effect.sessionId,
			generation: effect.generation,
			healthy: outcome.type === "healthy",
			reason: outcome.type === "unhealthy" ? outcome.reason : undefined,
		});
	}
}

function executeWriteEffect(
	adapter: TranscriptRendererAdapter,
	effect: TranscriptViewportEffect
): void {
	if (effect.type === "RevealRow") {
		adapter.reportEffectOutcome(adapter.revealRow(effect));
		return;
	}
	if (effect.type === "RevealTail") {
		adapter.reportEffectOutcome(adapter.revealTail(effect));
		return;
	}
	if (effect.type === "ApplyScrollOffset") {
		adapter.reportEffectOutcome(adapter.applyScrollOffset(effect));
	}
}

export function createTranscriptViewportScheduler(
	options: TranscriptViewportSchedulerOptions
): TranscriptViewportScheduler {
	const requestFrame = options.requestFrame ?? requestAnimationFrame;
	const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
	let frameId: number | null = null;
	const pendingEffects: TranscriptViewportEffect[] = [];

	function flush(): void {
		frameId = null;
		const currentEffects = pendingEffects.splice(0, pendingEffects.length);
		const readEffects = currentEffects.filter(isReadEffect);
		const writeEffects = currentEffects.filter((effect) => !isReadEffect(effect));

		for (const effect of readEffects) {
			if (!isEffectCurrent(effect, options.getSessionId, options.getGeneration)) {
				options.adapter.reportEffectOutcome(skippedOutcome(effect, "stale-generation"));
				continue;
			}
			executeReadEffect(options.adapter, effect, options.dispatchEvent);
		}

		for (const effect of writeEffects) {
			if (!isEffectCurrent(effect, options.getSessionId, options.getGeneration)) {
				options.adapter.reportEffectOutcome(skippedOutcome(effect, "stale-generation"));
				continue;
			}
			executeWriteEffect(options.adapter, effect);
		}
	}

	function ensureFrame(): void {
		if (frameId !== null) {
			return;
		}
		frameId = requestFrame(() => {
			flush();
		});
	}

	return {
		schedule(effects) {
			for (const effect of effects) {
				appendPendingEffect(pendingEffects, effect);
			}
			if (pendingEffects.length > 0) {
				ensureFrame();
			}
		},
		cancel() {
			if (frameId !== null) {
				cancelFrame(frameId);
				frameId = null;
			}
			pendingEffects.length = 0;
		},
	};
}
