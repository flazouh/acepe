import type { TranscriptViewportMeasurement } from "./transcript-viewport-events.js";
import type { TranscriptViewportEffect } from "./transcript-viewport-effects.js";

export type TranscriptRendererMeasurementOutcome =
	| {
			type: "measured";
			measurement: TranscriptViewportMeasurement;
	  }
	| {
			type: "missing";
			reason: "missing-adapter" | "missing-target";
	  };

export type TranscriptRendererAnchorCaptureOutcome =
	| {
			type: "captured";
			anchorKey: string;
			offsetPx: number;
	  }
	| {
			type: "missing";
			reason: "missing-adapter" | "missing-target";
	  };

export type TranscriptRendererAnchorMeasurementOutcome =
	| {
			type: "measured";
			anchorKey: string;
			offsetPx: number;
	  }
	| {
			type: "missing";
			anchorKey: string;
			reason: "missing-adapter" | "missing-target";
	  };

export type TranscriptRendererEffectOutcome =
	| {
			type: "applied";
			effectType: string;
	  }
	| {
			type: "skipped";
			effectType: string;
			reason: "stale-generation" | "missing-adapter" | "missing-target";
	  };

export type TranscriptRendererHealthOutcome =
	| {
			type: "healthy";
	  }
	| {
			type: "unhealthy";
			reason: "zero_viewport" | "no_rendered_entries";
	  };

export type TranscriptRendererAdapter = {
	measureViewport(): TranscriptRendererMeasurementOutcome;
	captureAnchor(): TranscriptRendererAnchorCaptureOutcome;
	measureAnchor(anchorKey: string): TranscriptRendererAnchorMeasurementOutcome;
	revealRow(
		effect: Extract<TranscriptViewportEffect, { type: "RevealRow" }>
	): TranscriptRendererEffectOutcome;
	revealTail(
		effect: Extract<TranscriptViewportEffect, { type: "RevealTail" }>
	): TranscriptRendererEffectOutcome;
	applyScrollOffset(
		effect: Extract<TranscriptViewportEffect, { type: "ApplyScrollOffset" }>
	): TranscriptRendererEffectOutcome;
	probeRendererHealth(): TranscriptRendererHealthOutcome;
	reportEffectOutcome(outcome: TranscriptRendererEffectOutcome): void;
};

export type VirtuaTranscriptHandle = {
	getScrollOffset(): number;
	getScrollSize(): number;
	getViewportSize(): number;
	scrollToIndex(index: number, options?: { align?: "start" | "center" | "end" }): void;
	scrollTo(offset: number): void;
};

export type VirtuaTranscriptRendererAdapterOptions = {
	getHandle(): VirtuaTranscriptHandle | null | undefined;
	getRowKeys(): readonly string[];
};

export type NativeTranscriptRendererAdapterOptions = {
	getContainer(): HTMLDivElement | null;
	getRowKeys(): readonly string[];
	getRowElement(rowKey: string): HTMLElement | null;
};

function missingMeasurement(): TranscriptRendererMeasurementOutcome {
	return {
		type: "missing",
		reason: "missing-adapter",
	};
}

function missingEffect(effectType: string): TranscriptRendererEffectOutcome {
	return {
		type: "skipped",
		effectType,
		reason: "missing-adapter",
	};
}

function findRowIndex(rowKeys: readonly string[], rowKey: string): number {
	for (let index = 0; index < rowKeys.length; index += 1) {
		if (rowKeys[index] === rowKey) {
			return index;
		}
	}
	return -1;
}

export function createVirtuaTranscriptRendererAdapter(
	options: VirtuaTranscriptRendererAdapterOptions
): TranscriptRendererAdapter {
	return {
		measureViewport() {
			const handle = options.getHandle();
			if (handle == null) {
				return missingMeasurement();
			}
			return {
				type: "measured",
				measurement: {
					scrollOffset: handle.getScrollOffset(),
					scrollSize: handle.getScrollSize(),
					viewportSize: handle.getViewportSize(),
				},
			};
		},
		captureAnchor() {
			const rowKeys = options.getRowKeys();
			const anchorKey = rowKeys[0];
			if (anchorKey === undefined) {
				return {
					type: "missing",
					reason: "missing-target",
				};
			}
			return {
				type: "captured",
				anchorKey,
				offsetPx: options.getHandle()?.getScrollOffset() ?? 0,
			};
		},
		measureAnchor(anchorKey) {
			const index = findRowIndex(options.getRowKeys(), anchorKey);
			if (index < 0) {
				return {
					type: "missing",
					anchorKey,
					reason: "missing-target",
				};
			}
			return {
				type: "measured",
				anchorKey,
				offsetPx: options.getHandle()?.getScrollOffset() ?? 0,
			};
		},
		revealRow(effect) {
			const handle = options.getHandle();
			if (handle == null) {
				return missingEffect(effect.type);
			}
			const index = findRowIndex(options.getRowKeys(), effect.targetKey);
			if (index < 0) {
				return {
					type: "skipped",
					effectType: effect.type,
					reason: "missing-target",
				};
			}
			handle.scrollToIndex(index, { align: effect.align });
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		revealTail(effect) {
			const handle = options.getHandle();
			if (handle == null) {
				return missingEffect(effect.type);
			}
			const lastIndex = options.getRowKeys().length - 1;
			if (lastIndex < 0) {
				return {
					type: "skipped",
					effectType: effect.type,
					reason: "missing-target",
				};
			}
			handle.scrollToIndex(lastIndex, { align: "end" });
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		applyScrollOffset(effect) {
			const handle = options.getHandle();
			if (handle == null) {
				return missingEffect(effect.type);
			}
			handle.scrollTo(effect.offsetPx);
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		probeRendererHealth() {
			const handle = options.getHandle();
			if (handle == null) {
				return {
					type: "unhealthy",
					reason: "zero_viewport",
				};
			}
			if (handle.getViewportSize() <= 0) {
				return {
					type: "unhealthy",
					reason: "zero_viewport",
				};
			}
			return {
				type: "healthy",
			};
		},
		reportEffectOutcome() {
			return;
		},
	};
}

export function createNativeTranscriptRendererAdapter(
	options: NativeTranscriptRendererAdapterOptions
): TranscriptRendererAdapter {
	return {
		measureViewport() {
			const container = options.getContainer();
			if (container === null) {
				return missingMeasurement();
			}
			return {
				type: "measured",
				measurement: {
					scrollOffset: container.scrollTop,
					scrollSize: container.scrollHeight,
					viewportSize: container.clientHeight,
				},
			};
		},
		captureAnchor() {
			const rowKeys = options.getRowKeys();
			const anchorKey = rowKeys[0];
			if (anchorKey === undefined) {
				return {
					type: "missing",
					reason: "missing-target",
				};
			}
			const container = options.getContainer();
			return {
				type: "captured",
				anchorKey,
				offsetPx: container?.scrollTop ?? 0,
			};
		},
		measureAnchor(anchorKey) {
			const row = options.getRowElement(anchorKey);
			if (row === null) {
				return {
					type: "missing",
					anchorKey,
					reason: "missing-target",
				};
			}
			const container = options.getContainer();
			return {
				type: "measured",
				anchorKey,
				offsetPx: container?.scrollTop ?? 0,
			};
		},
		revealRow(effect) {
			const row = options.getRowElement(effect.targetKey);
			if (row === null) {
				return {
					type: "skipped",
					effectType: effect.type,
					reason: "missing-target",
				};
			}
			row.scrollIntoView({ block: effect.align === "start" ? "start" : "end" });
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		revealTail(effect) {
			const container = options.getContainer();
			if (container === null) {
				return missingEffect(effect.type);
			}
			container.scrollTop = container.scrollHeight;
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		applyScrollOffset(effect) {
			const container = options.getContainer();
			if (container === null) {
				return missingEffect(effect.type);
			}
			container.scrollTop = effect.offsetPx;
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		probeRendererHealth() {
			const container = options.getContainer();
			if (container === null || container.clientHeight <= 0) {
				return {
					type: "unhealthy",
					reason: "zero_viewport",
				};
			}
			return {
				type: "healthy",
			};
		},
		reportEffectOutcome() {
			return;
		},
	};
}
