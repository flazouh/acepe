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
	getRowIndex?(rowKey: string): number | undefined;
	getContainer?(): HTMLElement | null;
	getRowElement?(rowKey: string): HTMLElement | null;
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

function findRowIndex(
	options: Pick<VirtuaTranscriptRendererAdapterOptions, "getRowKeys" | "getRowIndex">,
	rowKey: string
): number {
	const indexedRow = options.getRowIndex?.(rowKey);
	if (typeof indexedRow === "number") {
		return indexedRow;
	}
	const rowKeys = options.getRowKeys();
	for (let index = 0; index < rowKeys.length; index += 1) {
		if (rowKeys[index] === rowKey) {
			return index;
		}
	}
	return -1;
}

function measureRowOffsetInContainer(container: HTMLElement, row: HTMLElement): number {
	return row.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

function isRowVisibleInContainer(container: HTMLElement, row: HTMLElement): boolean {
	const containerRect = container.getBoundingClientRect();
	const rowRect = row.getBoundingClientRect();
	return rowRect.bottom > containerRect.top && rowRect.top < containerRect.bottom;
}

function collectHorizontalScrollAncestors(element: HTMLElement | null): HTMLElement[] {
	const ancestors: HTMLElement[] = [];
	let current = element?.parentElement ?? null;
	while (current !== null) {
		if (current.scrollWidth > current.clientWidth) {
			ancestors.push(current);
		}
		current = current.parentElement;
	}
	return ancestors;
}

function preserveHorizontalScroll(container: HTMLElement | null, write: () => void): void {
	const ancestors = collectHorizontalScrollAncestors(container);
	const snapshots = ancestors.map((ancestor) => ({
		ancestor,
		scrollLeft: ancestor.scrollLeft,
	}));
	write();
	for (const snapshot of snapshots) {
		snapshot.ancestor.scrollLeft = snapshot.scrollLeft;
	}
}

function revealRowInContainer(
	container: HTMLDivElement,
	row: HTMLElement,
	align: "start" | "center" | "end"
): void {
	const containerRect = container.getBoundingClientRect();
	const rowRect = row.getBoundingClientRect();
	if (align === "start") {
		container.scrollTop += rowRect.top - containerRect.top;
		return;
	}
	if (align === "center") {
		const containerCenter = containerRect.top + containerRect.height / 2;
		const rowCenter = rowRect.top + rowRect.height / 2;
		container.scrollTop += rowCenter - containerCenter;
		return;
	}
	container.scrollTop += rowRect.bottom - containerRect.bottom;
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
			const container = options.getContainer?.() ?? null;
			if (container !== null && options.getRowElement !== undefined) {
				for (const rowKey of rowKeys) {
					const row = options.getRowElement(rowKey);
					if (row !== null && isRowVisibleInContainer(container, row)) {
						return {
							type: "captured",
							anchorKey: rowKey,
							offsetPx: measureRowOffsetInContainer(container, row),
						};
					}
				}
			}
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
			const container = options.getContainer?.() ?? null;
			const row = options.getRowElement?.(anchorKey) ?? null;
			if (container !== null && row !== null) {
				return {
					type: "measured",
					anchorKey,
					offsetPx: measureRowOffsetInContainer(container, row),
				};
			}
			const index = findRowIndex(options, anchorKey);
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
			const index = findRowIndex(options, effect.targetKey);
			if (index < 0) {
				return {
					type: "skipped",
					effectType: effect.type,
					reason: "missing-target",
				};
			}
			preserveHorizontalScroll(options.getContainer?.() ?? null, () => {
				handle.scrollToIndex(index, { align: effect.align });
			});
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
			preserveHorizontalScroll(options.getContainer?.() ?? null, () => {
				handle.scrollToIndex(lastIndex, { align: "end" });
			});
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
			preserveHorizontalScroll(options.getContainer?.() ?? null, () => {
				handle.scrollTo(effect.offsetPx);
			});
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
			const container = options.getContainer();
			if (container === null) {
				return {
					type: "missing",
					reason: "missing-adapter",
				};
			}
			for (const rowKey of rowKeys) {
				const row = options.getRowElement(rowKey);
				if (row !== null && isRowVisibleInContainer(container, row)) {
					return {
						type: "captured",
						anchorKey: rowKey,
						offsetPx: measureRowOffsetInContainer(container, row),
					};
				}
			}
			if (rowKeys[0] === undefined) {
				return {
					type: "missing",
					reason: "missing-target",
				};
			}
			return {
				type: "missing",
				reason: "missing-target",
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
			if (container === null) {
				return {
					type: "missing",
					anchorKey,
					reason: "missing-adapter",
				};
			}
			return {
				type: "measured",
				anchorKey,
				offsetPx: measureRowOffsetInContainer(container, row),
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
			const container = options.getContainer();
			if (container === null) {
				return missingEffect(effect.type);
			}
			revealRowInContainer(container, row, effect.align);
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
